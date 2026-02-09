# 📖 Yuzu Section Extractor

Chrome extension to extract textbook sections from [Yuzu Reader](https://reader.yuzu.com) as **printable PDFs** or **Markdown with LaTeX math & embedded images**.

---

## Installation

1. Clone or download this repo
2. Go to `chrome://extensions` → enable **Developer mode**
3. Click **Load unpacked** → select the `dist/` folder
4. Open a book on [reader.yuzu.com](https://reader.yuzu.com)

## Usage

1. Navigate to the section you want
2. Click the extension icon
3. Pick your format:
   - **🖨️ Print PDF** — opens a clean page, use `Ctrl+P` to save
   - **📝 Download .md** — Markdown with LaTeX math and images baked in

## Building from source

```bash
npm install
node build.js
```

## Disclaimer

For **personal academic use** only. Respect copyright and your institution's ToS.

## License

MIT
