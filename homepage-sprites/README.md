# Homepage Sprites

The homepage uses an adapted copy of the Sprites interface and its localization files. The interface markup lives in the root `index.html`; the scripts and styles are in this directory. Animated clips are loaded from jsDelivr, with a still-image fallback.

Run the video analytics checks with:

```sh
node --test homepage-sprites/tests/video-analytics.test.cjs
```
