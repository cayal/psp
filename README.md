# Pukable Slot Pockets
Pukable Slot Pockets is an experimental frontend tool for declarative templating within HTML using syntax loosely based on the HTML Modules proposal.

On execution, it starts a local HTTP server with hot-reloading over WebSockets, which streams
HTML files piece-by-piece to `https://localhost:3003`

It introduces a `<!slurp from="src/to/b.html#foobar", as="name-here">` declaration, which creates a scoped import resolution applicable to an entire `.html` file regardless of its position.

The `from` parameter is a relative link to an HTML fragment or file in the `src` folder.
If there is no `#fragment` in the URL, the `<body>` tag of the target will become the slurpee.

All appearances of the `as` parameter (for example, `<name-here></name-here>`) will then
be replaced with the inner content of the fragment referenced by `from`.

# Installation
PSP has no JavaScript dependencies for running other than a TypeScript interpreter for node versions <23.

## Running
1) TypeScript
    a) Node >= 23: 0 dependencies, run with `node ./server.ts --experimental-strip-types=true`.
    b) For Node versions under 23, PSP depends on `tsx` to execute. Run `npm install` to install.
2) HTTPS
Any method of generating a local certfile will work.
The cert should be named `localhost.pem`, and the key should be named `localhost-key.pem`.
Both should be located or symlinked in the project directory adjacent to `server.ts`.

On macOS, `mkcert` is a convenient program for cert generation:
```bash
$ brew install mkcert
$ mkcert install
$ mkcert localhost
```

## Testing
After running `npm install`, use `npm run test` to test with Vitest.

