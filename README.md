# Blektre Web2View (Windows)

This is a minimal Electron wrapper that loads https://blektre.com.

## Run

```bash
npm install
npm start
```

## Package (.exe)

```bash
npm run dist
```

The installer will be created in `dist/`.

## Notes

- External links open in the default browser.
- The app is a single WebView window focused on the game.
- Steamworks integration uses `steamworks.js` and assumes the app is launched by Steam.
- The wrapper posts the same messages as the C3 example: `demoversion`, `steamapp`, and storage restore keys.
- Local storage bridge is saved to a JSON file in the Electron userData folder.
- `steam_appid.txt` is included for local testing; Steam should be running.
