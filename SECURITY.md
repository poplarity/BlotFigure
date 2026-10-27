# Security and privacy

BlotFigure processes pictures entirely in the browser, with no image-processing server or telemetry. The Content Security Policy allows app resources and one configured feedback endpoint. Only an explicit feedback submission sends the typed message, optional reply email and version to that endpoint; no image, project, filename or lane labels are attached automatically. Support/Star links open only when clicked. Pictures are read from files you choose and results are saved through the browser.

Data kept on your computer, in the browser's storage for this page only:

- preferences (language, last ladder, pre-flight setting, whether the interface tour was seen);
- custom ladders;
- local project history (source pictures, every exposure, annotations and settings), with rename/delete controls;
- parameter presets and the last seen release version. Feedback drafts remain in memory during the current session.

## Reporting a vulnerability

If you find a way for a crafted picture or project file to run code, leak data or bypass the Content Security Policy, please report it privately through GitHub's [private vulnerability reporting](https://github.com/poplarity/BlotFigure/security/advisories/new) rather than a public issue.
