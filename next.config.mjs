/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
  // planilhas de pedidos da Shopee podem passar de 1 MB
  experimental: { serverActions: { bodySizeLimit: "20mb" } },
};
export default nextConfig;
