# Security and privacy

BlotFigure runs entirely in the browser. It has no server, collects no telemetry and sends no data anywhere; a Content Security Policy in `index.html` forbids connections to any server other than the page's own origin (from which it loads only its own files). Pictures are read from files you choose and results are saved through your browser's downloads.

Data kept on your computer, in the browser's storage for this page only:

- preferences (language, last ladder, pre-flight setting, whether the interface tour was seen);
- custom ladders;
- the autosaved draft (the pictures and the current state), which you can discard from the start screen.

## Reporting a vulnerability

If you find a way for a crafted picture or project file to run code, leak data or bypass the Content Security Policy, please report it privately through GitHub's [private vulnerability reporting](https://github.com/poplarity/BlotFigure/security/advisories/new) rather than a public issue.