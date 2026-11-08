/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 不暴露 X-Powered-By；项目未使用 next/image，配合 WAF 封禁 /_next/image
  poweredByHeader: false,
  images: {
    unoptimized: true,
  },
}

module.exports = nextConfig

if (process.env.NODE_ENV === 'development') {
  const { setupDevBindings } = require('@cloudflare/next-on-pages/next-dev')
  setupDevBindings({
    bindings: {
      UPTIMEFLARE_STATE: {
        type: 'kv',
        id: 'UPTIMEFLARE_STATE',
      },
    },
  })
}
