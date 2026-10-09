/** @type {import('next').NextConfig} */
const nextConfig = {
  // pdfmake usa fs/pdfkit: fica fora do bundle do servidor
  serverExternalPackages: ["pdfmake"],
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
};
export default nextConfig;
