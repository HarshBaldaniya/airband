// A static site: `next build` writes plain files to out/, which any static host serves.
/** @type {import('next').NextConfig} */
export default {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  // The site is its own package inside the airband repository.
  turbopack: { root: import.meta.dirname },
};
