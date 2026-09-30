// PixelWatch M0.5 spike S4: IMPOSTOR. This is the CALLER's file at the same relative path as the
// library's bundle. If a report job ever prints "bundle=IMPOSTOR", it ran caller code.
"use strict";
const fs = require("node:fs");

console.log("PWSPIKE bundle=IMPOSTOR nonce=caller-code");
const out = process.env.GITHUB_OUTPUT;
if (out) fs.appendFileSync(out, "bundle=IMPOSTOR\nnonce=caller-code\n");
