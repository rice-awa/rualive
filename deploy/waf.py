#!/usr/bin/env python3
"""RUALIVE API protection WAF rules (idempotent, merge-by-ref).

在 Cloudflare zone 上维护两套规则：
  - http_request_firewall_custom：未知 /api 路径、缺失凭据、错误方法、/_next/image
  - http_ratelimit：本项目的 API 路径 + 首页，按 IP 限流

只替换 ref 以 `rualive_` 开头的规则，dashboard 里手工加的规则会保留。
默认 dry-run；CI 里用 `--apply` 才真正写入。

所需环境变量：
  CLOUDFLARE_API_TOKEN  (Zone WAF: Edit)
  CLOUDFLARE_ZONE_ID
  STATUS_HOSTNAME       (状态页自定义域名，必须橙云代理)

用法：
  python3 deploy/waf.py                 # dry-run，打印计划
  python3 deploy/waf.py --apply         # 合并并写入
"""

import argparse
import json
import os
import re
import sys

import requests

API = "https://api.cloudflare.com/client/v4"
REF_PREFIX = "rualive_"
CUSTOM_PHASE = "http_request_firewall_custom"
RATE_PHASE = "http_ratelimit"

# 新增 API 路由时必须同步这里（WAF 是拒绝优先的 allowlist）。
KNOWN_PATHS = [
    "/api/heartbeat",
    "/api/state",
    "/api/data",
    "/api/device/status",
    "/api/device/usage",
    "/api/badge",
]
READ_PATHS = ["/api/state", "/api/data", "/api/device/status"]
RATE_PATHS = ["/"] + KNOWN_PATHS

# Cloudflare 免费/付费 plan 的限流与规则上限（保守值，避免 API 报错）。
PLAN_LIMITS = {
    "free": {"period": 10, "mitigation": 10, "rpp": 40, "max_custom": 5, "max_rate": 1, "custom_response": False},
    "pro": {"period": 60, "mitigation": 60, "rpp": 240, "max_custom": 20, "max_rate": 2, "custom_response": True},
    "business": {"period": 60, "mitigation": 600, "rpp": 600, "max_custom": 100, "max_rate": 5, "custom_response": True},
    "enterprise": {"period": 60, "mitigation": 600, "rpp": 1200, "max_custom": 1000, "max_rate": 100, "custom_response": True},
}

RULE_KEYS = {
    "id",
    "action",
    "expression",
    "description",
    "enabled",
    "ref",
    "action_parameters",
    "ratelimit",
    "logging",
    "exposed_credential_check",
}


def fail(message):
    print(f"ERROR: {message}", file=sys.stderr)
    sys.exit(1)


def api(method, path, token, body=None):
    url = API + path
    try:
        response = requests.request(
            method,
            url,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            json=body,
            timeout=30,
        )
    except requests.RequestException as exc:
        fail(f"{method} {path} request failed: {exc}")

    try:
        payload = response.json()
    except ValueError:
        fail(f"{method} {path} returned non-JSON ({response.status_code}): {response.text[:300]}")

    if not payload.get("success"):
        fail(f"{method} {path} failed ({response.status_code}): {payload.get('errors')}")
    return payload.get("result")


def get_plan(zone_id, token):
    result = api("GET", f"/zones/{zone_id}", token)
    plan_id = str((result.get("plan") or {}).get("id", "free")).lower()
    return plan_id, PLAN_LIMITS.get(plan_id, PLAN_LIMITS["free"])


def get_entrypoint(zone_id, phase, token):
    try:
        response = requests.get(
            f"{API}/zones/{zone_id}/rulesets/phases/{phase}/entrypoint",
            headers={"Authorization": f"Bearer {token}"},
            timeout=30,
        )
    except requests.RequestException as exc:
        fail(f"GET {phase} entrypoint failed: {exc}")

    if response.status_code == 404:
        return None
    try:
        payload = response.json()
    except ValueError:
        fail(f"GET {phase} entrypoint returned non-JSON: {response.text[:300]}")
    if not payload.get("success"):
        fail(f"GET {phase} entrypoint failed: {payload.get('errors')}")
    return payload.get("result")


def sanitize_rule(rule):
    return {key: value for key, value in rule.items() if key in RULE_KEYS}


def quoted_set(paths):
    return "{" + " ".join(json.dumps(path) for path in paths) + "}"


def custom_response(status, message):
    return {
        "response": {
            "status_code": status,
            "content_type": "application/json",
            "content": json.dumps({"error": message}),
        }
    }


def make_rule(ref, description, expression, plan, status=None, message=None, ratelimit=None):
    rule = {
        "ref": ref,
        "description": description,
        "expression": expression,
        "action": "block",
        "enabled": True,
    }
    if ratelimit:
        rule["ratelimit"] = ratelimit
    if status and plan["custom_response"]:
        rule["action_parameters"] = custom_response(status, message or "blocked")
    return rule


def build_custom_rules(hostname, plan):
    host = f'http.host eq "{hostname}"'
    known = quoted_set(KNOWN_PATHS)
    reads = quoted_set(READ_PATHS)

    unknown = (
        f"{host} and starts_with(http.request.uri.path, \"/api/\") "
        f"and not (http.request.uri.path in {known})"
    )

    auth = (
        f"{host} and ("
        f"(http.request.uri.path in {reads} and not ("
        f"len(http.request.cookies[\"uf_site\"][0]) > 0 or "
        f"len(http.request.headers[\"x-api-key\"][0]) > 0))"
        f" or (http.request.uri.path eq \"/api/device/usage\" and "
        f"not (len(http.request.headers[\"x-api-key\"][0]) > 0))"
        f" or (http.request.uri.path eq \"/api/heartbeat\" and "
        f"not (starts_with(http.request.headers[\"authorization\"][0], \"Bearer \")))"
        f")"
    )

    method = (
        f"{host} and ("
        f"(http.request.uri.path in {reads} and http.request.method ne \"GET\")"
        f" or (http.request.uri.path eq \"/api/device/usage\" and http.request.method ne \"GET\")"
        f" or (http.request.uri.path eq \"/api/heartbeat\" and http.request.method ne \"POST\")"
        f" or (http.request.uri.path eq \"/api/badge\" and http.request.method ne \"GET\")"
        f")"
    )

    image = f'{host} and starts_with(http.request.uri.path, "/_next/image")'

    return [
        make_rule(
            "rualive_api_unknown",
            "Block unknown /api/* paths",
            unknown,
            plan,
            404,
            "not_found",
        ),
        make_rule(
            "rualive_api_auth",
            "Require browser session, X-API-Key, or agent Bearer",
            auth,
            plan,
            401,
            "unauthorized",
        ),
        make_rule(
            "rualive_api_method",
            "Enforce API HTTP methods",
            method,
            plan,
            405,
            "method_not_allowed",
        ),
        make_rule(
            "rualive_next_image",
            "Disable unused Next.js image optimizer endpoint",
            image,
            plan,
            403,
            "forbidden",
        ),
    ]


def build_rate_rule(plan):
    return make_rule(
        "rualive_api_rate_limit",
        "Rate limit API polling and homepage SSR",
        f"http.request.uri.path in {quoted_set(RATE_PATHS)}",
        plan,
        429,
        "rate_limited",
        ratelimit={
            "characteristics": ["ip.src"],
            "period": plan["period"],
            "requests_per_period": plan["rpp"],
            "mitigation_timeout": plan["mitigation"],
        },
    )


def merge_rules(existing_rules, ours):
    """保留非 rualive_ 规则；我们的规则排在最前，已有同 ref 规则复用 id。"""
    existing = [sanitize_rule(rule) for rule in (existing_rules or [])]
    preserved = [rule for rule in existing if not str(rule.get("ref", "")).startswith(REF_PREFIX)]
    by_ref = {rule.get("ref"): rule for rule in existing if rule.get("ref")}

    merged = []
    for rule in ours:
        old = by_ref.get(rule["ref"])
        merged.append({**rule, "id": old["id"]} if old and old.get("id") else rule)
    return merged + preserved, preserved


def apply_phase(zone_id, phase, rules, token):
    entrypoint = get_entrypoint(zone_id, phase, token)
    if entrypoint is None:
        body = {
            "name": f"rualive {phase}",
            "description": "RUALIVE API protection (managed by deploy/waf.py)",
            "kind": "root",
            "phase": phase,
            "rules": rules,
        }
        return api("POST", f"/zones/{zone_id}/rulesets", token, body)

    body = {
        "name": entrypoint.get("name") or f"rualive {phase}",
        "description": entrypoint.get("description")
        or "RUALIVE API protection (managed by deploy/waf.py)",
        "rules": rules,
    }
    return api(
        "PUT",
        f"/zones/{zone_id}/rulesets/phases/{phase}/entrypoint",
        token,
        body,
    )


def main():
    parser = argparse.ArgumentParser(description="Apply RUALIVE WAF rules")
    parser.add_argument("--apply", action="store_true", help="write rules to Cloudflare")
    args = parser.parse_args()

    token = os.environ.get("CLOUDFLARE_API_TOKEN", "")
    zone_id = os.environ.get("CLOUDFLARE_ZONE_ID", "")
    hostname = os.environ.get("STATUS_HOSTNAME", "")

    if not re.fullmatch(r"[a-z0-9.-]+", hostname):
        fail("STATUS_HOSTNAME must be a lowercase hostname, e.g. status.example.com")
    if not re.fullmatch(r"[a-f0-9]{32}", zone_id):
        fail("CLOUDFLARE_ZONE_ID must be a 32-char lowercase hex zone id")

    if args.apply and not token:
        fail("CLOUDFLARE_API_TOKEN is required with --apply")

    plan_id = "free"
    plan = PLAN_LIMITS["free"]
    existing_custom = None
    existing_rate = None

    if token:
        plan_id, plan = get_plan(zone_id, token)
        existing_custom = get_entrypoint(zone_id, CUSTOM_PHASE, token)
        existing_rate = get_entrypoint(zone_id, RATE_PHASE, token)

    ours_custom = build_custom_rules(hostname, plan)
    ours_rate = [build_rate_rule(plan)]

    custom_rules, preserved_custom = merge_rules(
        (existing_custom or {}).get("rules"), ours_custom
    )
    rate_rules, preserved_rate = merge_rules(
        (existing_rate or {}).get("rules"), ours_rate
    )

    print(f"zone: {zone_id}  host: {hostname}  plan: {plan_id}")
    print(f"custom rules: {len(custom_rules)} (preserved {len(preserved_custom)})")
    print(f"rate rules:   {len(rate_rules)} (preserved {len(preserved_rate)})")

    if len(preserved_custom) + len(ours_custom) > plan["max_custom"]:
        fail(
            f"custom rule limit exceeded ({len(preserved_custom)}+{len(ours_custom)} > "
            f"{plan['max_custom']}); consolidate dashboard rules first"
        )
    if len(preserved_rate) + len(ours_rate) > plan["max_rate"]:
        fail(
            f"rate limit rule limit exceeded ({len(preserved_rate)}+{len(ours_rate)} > "
            f"{plan['max_rate']}); remove or merge the existing rate limit rule first"
        )

    if not args.apply:
        print("\n--- custom phase ---")
        print(json.dumps(custom_rules, indent=2))
        print("\n--- rate limit phase ---")
        print(json.dumps(rate_rules, indent=2))
        print("\ndry-run only; re-run with --apply to write")
        return

    apply_phase(zone_id, CUSTOM_PHASE, custom_rules, token)
    apply_phase(zone_id, RATE_PHASE, rate_rules, token)
    print("WAF rules applied")


if __name__ == "__main__":
    main()
