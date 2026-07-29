# ⚡ PixelForge

<p align="center">
  <b>A fast, 100% browser-based, privacy-first image editing & conversion studio.</b>
</p>

<p align="center">
  <a href="https://github.com/Mudassirdbs/PixelForge/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="Apache 2.0 License">
  </a>
  <img src="https://img.shields.io/badge/React-19.0-61dafb.svg" alt="React 19">
  <img src="https://img.shields.io/badge/TypeScript-5.8-3178c6.svg" alt="TypeScript">
  <img src="https://img.shields.io/badge/Vite-8.0-646cff.svg" alt="Vite">
  <img src="https://img.shields.io/badge/TailwindCSS-v4.0-38bdf8.svg" alt="Tailwind CSS">
</p>

---

## 🌟 Overview

**PixelForge** is a modern, high-performance web application designed to convert, compress, resize, and perform AI-powered background removal on images—**entirely inside your browser**. 

No files are ever uploaded to a remote server. Your privacy is 100% guaranteed because all heavy processing runs locally using WebAssembly (WASM), Canvas API, and Web Workers.

---

## ✨ Key Features

- 🔒 **100% Private & Browser-Based**: All processing happens locally. Zero data collection, zero server uploads.
- 🤖 **AI Background Removal**: Instant background removal powered by in-browser ONNX WebAssembly model.
- 🔄 **Multi-Format Image Converter**: Seamlessly convert between **PNG, JPG, WEBP, AVIF, SVG, HEIC, TIFF, PDF, and Base64**.
- 🗜️ **Smart Image Compressor**: Reduce file sizes significantly while maintaining visual quality.
- 📐 **Precision Resizer**: Resize images by custom dimensions or percentage scale.
- 📦 **Bulk Batch Processing**: Upload multiple files at once and download all converted assets as a single `.ZIP` archive.
- ⚡ **Ultra Fast & Offline Capable**: Instant previews and sub-second processing.

---

## 📂 Supported Formats

| Format | Import | Export | Description |
| :--- | :---: | :---: | :--- |
| **PNG** | ✅ | ✅ | Portable Network Graphics |
| **JPG / JPEG** | ✅ | ✅ | Joint Photographic Experts Group |
| **WEBP** | ✅ | ✅ | Web Picture Format |
| **AVIF** | ✅ | ✅ | AV1 Image File Format |
| **SVG** | ✅ | ✅ | Scalable Vector Graphics |
| **HEIC / HEIF** | ✅ | ✅ | High Efficiency Image Format (iPhone) |
| **TIFF / TIF** | ✅ | ✅ | Tagged Image File Format |
| **PDF** | ✅ | ✅ | Single & Multi-Page Document |
| **Base64** | ✅ | ✅ | Data URI string for developers |

---

## 🛠️ Tech Stack

- **Core Framework**: [React 19](https://react.dev/)
- **Routing & SSR Engine**: [TanStack Start](https://tanstack.com/router) + [TanStack Router](https://tanstack.com/router)
- **Bundler & Build Tool**: [Vite 8](https://vitejs.dev/) + [Nitro Engine](https://nitro.unjs.io/)
- **Styling & UI**: [Tailwind CSS v4](https://tailwindcss.com/) + [Radix UI Primitives](https://www.radix-ui.com/) + [Lucide Icons](https://lucide.dev/)
- **In-Browser Processing Libraries**:
  - `@imgly/background-removal` (In-browser WASM AI)
  - `heic-to` (HEIC image decoder)
  - `utif` (TIFF format parser)
  - `jspdf` (PDF generation)
  - `jszip` (Client-side ZIP packaging)
- **Language**: [TypeScript](https://www.typescriptlang.org/)

---

## 🚀 Getting Started

### Prerequisites

Ensure you have **Node.js 18+** or **Bun** installed on your system.

### Local Development Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/Mudassirdbs/PixelForge.git
   cd PixelForge
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start the local dev server**:
   ```bash
   npm run dev
   ```
   Open your browser at [http://localhost:3000](http://localhost:3000).

4. **Build for production**:
   ```bash
   npm run build
   ```

5. **Preview production build locally**:
   ```bash
   npm run preview
   ```

---

## ☁️ Deployment

PixelForge is optimized to run on serverless & edge platforms out of the box:

### Cloudflare Pages (Recommended)
1. Import `Mudassirdbs/PixelForge` on [Cloudflare Pages](https://dash.cloudflare.com/).
2. Set Build Command: `npm run build`
3. Set Output Directory: `.output/public`

### Vercel
1. Import `Mudassirdbs/PixelForge` on [Vercel](https://vercel.com).
2. Vercel automatically detects the Nitro engine. Click **Deploy**.

---

## 📜 License

Distributed under the **Apache License 2.0**. See [`LICENSE`](./LICENSE) for more information.

---

## 👤 Author

**Mudassir Asghar**
- GitHub: [@Mudassirdbs](https://github.com/Mudassirdbs)
