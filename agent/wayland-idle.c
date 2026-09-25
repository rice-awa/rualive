/* Report KWin's input-idle transitions to the Python agent, one line per event. */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wayland-client.h>
#include "ext-idle-notify-v1-client-protocol.h"

static struct wl_seat *seat;
static struct ext_idle_notifier_v1 *notifier;
static uint32_t timeout_ms;

static void idle(void *data, struct ext_idle_notification_v1 *notification)
{
    (void)data;
    (void)notification;
    puts("idle");
    fflush(stdout);
}

static void active(void *data, struct ext_idle_notification_v1 *notification)
{
    (void)data;
    (void)notification;
    puts("active");
    fflush(stdout);
}

static const struct ext_idle_notification_v1_listener idle_listener = { idle, active };

static void global(void *data, struct wl_registry *registry, uint32_t name,
                   const char *interface, uint32_t version)
{
    (void)data;
    if (strcmp(interface, wl_seat_interface.name) == 0 && !seat)
        seat = wl_registry_bind(registry, name, &wl_seat_interface, 1);
    else if (strcmp(interface, ext_idle_notifier_v1_interface.name) == 0 && !notifier)
        notifier = wl_registry_bind(registry, name, &ext_idle_notifier_v1_interface,
                                    version < 2 ? version : 2);
}

static void global_remove(void *data, struct wl_registry *registry, uint32_t name)
{
    (void)data;
    (void)registry;
    (void)name;
}

static const struct wl_registry_listener registry_listener = { global, global_remove };

int main(int argc, char **argv)
{
    char *end;
    unsigned long seconds;
    struct wl_display *display;
    struct wl_registry *registry;
    struct ext_idle_notification_v1 *notification;

    if (argc != 2)
        return 2;
    seconds = strtoul(argv[1], &end, 10);
    if (*end || seconds == 0 || seconds > UINT32_MAX / 1000)
        return 2;
    timeout_ms = (uint32_t)seconds * 1000;

    display = wl_display_connect(NULL);
    if (!display)
        return 1;
    registry = wl_display_get_registry(display);
    wl_registry_add_listener(registry, &registry_listener, NULL);
    if (wl_display_roundtrip(display) < 0 || !seat || !notifier)
        return 1;

    if (wl_proxy_get_version((struct wl_proxy *)notifier) >= 2)
        notification = ext_idle_notifier_v1_get_input_idle_notification(notifier, timeout_ms, seat);
    else
        notification = ext_idle_notifier_v1_get_idle_notification(notifier, timeout_ms, seat);
    if (!notification)
        return 1;
    ext_idle_notification_v1_add_listener(notification, &idle_listener, NULL);
    if (wl_display_roundtrip(display) < 0)
        return 1;
    puts("ready");
    fflush(stdout);
    while (wl_display_dispatch(display) >= 0) {}
    return 1;
}
