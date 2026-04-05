# Keyran to AutoHotkey Converter

<div align="center">
  <img src="https://placehold.co/800x200/0f172a/2dd4bf?text=Keyran%20to%20AHK%20Converter" alt="Project Banner">
</div>

<div align="center">

[![Status](https://img.shields.io/badge/status-active-success.svg)]()
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](/LICENSE)
[![Made with](https://img.shields.io/badge/Made%20with-JavaScript-1f425f.svg)](https://www.javascript.com)

</div>

---

A powerful, client-side web tool that instantly converts Keyran XML macros into fully functional, togglable AutoHotkey (AHK) scripts. This converter accurately parses complex Keyran command structures, including partial loops, and provides options for speed adjustment and custom hotkeys, all within a clean and responsive interface.

## ✨ Features

- **Full XML Parsing:** Accurately reads the `<Syntax>` block within Keyran's `.krm` XML file structure.
- **Intelligent Looping:**
  - Handles full-script loops for macros set to repeat indefinitely.
  - Correctly interprets `GoWhile [line] [count]` commands to create precise, partial loops.
- **Custom Hotkeys:** Easily set a custom Start/Stop toggle key for your generated AHK script.
- **Speed Optimization:** Automatically includes AHK commands to run scripts at maximum speed, removing default delays.
- **Fine-Tuned Speed Control:** An intuitive slider allows you to adjust the timing of all `Delay` commands, from 50% to 150% of the original speed.
- **Accurate Key Mapping:** Translates Keyran's non-standard virtual key codes into the correct AHK key names based on real-world macro analysis.
- **Fully Client-Side:** The entire conversion process happens in your browser. No data is sent to a server, ensuring privacy and instant results.
- **Responsive Design:** A clean, modern UI that works great on both desktop and mobile devices.

## 🚀 How to Use

There are two ways to use this converter:

### 1. Running Locally (Recommended)

This is the simplest method and requires no special software.

1.  **Download the File:** Download the `converter.html` file from this repository.
2.  **Open in Your Browser:** Double-click the `converter.html` file. It will open directly in your default web browser (like Chrome, Firefox, or Edge).
3.  **Use the Converter:**
    - Paste your entire Keyran XML macro into the "Keyran Macro (XML)" text area on the left.
    - Set your desired **Start/Stop Hotkey**.
    - Adjust the **Speed** slider if needed.
    - Click the **Convert Script** button.
    - The generated AutoHotkey script will appear on the right. Click **Copy** to copy it to your clipboard.
    - Save the copied script as a `.ahk` file and run it with AutoHotkey.

### 2. Live Demo (Online)

You can access a live version of the converter here:

➡️ **[Live Demo Link](https://hebbins.github.io/KeyranToAHSConverter/converter.html)**

## 🛠️ How It Works

The converter uses a combination of JavaScript technologies to perform the conversion entirely within the browser:

1.  **DOM Parser:** The application uses the browser's built-in `DOMParser` to read and understand the structure of the pasted Keyran XML. It specifically looks for the commands inside the `<KeyDown><Syntax>` tags.
2.  **Command Translation:** A JavaScript function iterates through each line of the Keyran syntax. It uses a predefined `keyranKeyCodeMap` object to translate Keyran's numeric key codes (e.g., `26`) into their correct AutoHotkey names (e.g., `w`).
3.  **Loop & Logic Handling:** The script intelligently detects if a `GoWhile` command is present to create a partial `Loop`, or if it should wrap the entire script in a togglable loop.
4.  **AHK Boilerplate Injection:** The translated commands are wrapped in a robust AutoHotkey template that includes performance optimizations, a toggle variable, and the user-defined hotkey.
5.  **Dynamic Updates:** The entire user interface is interactive, with the output updating instantly when you click the "Convert Script" button.

## 🤝 Contributing

Contributions are welcome! If you have ideas for new features, find a bug, or want to improve the key mappings, please feel free to:

1.  Fork the repository.
2.  Create a new branch (`git checkout -b feature/AmazingFeature`).
3.  Commit your changes (`git commit -m 'Add some AmazingFeature'`).
4.  Push to the branch (`git push origin feature/AmazingFeature`).
5.  Open a Pull Request.
