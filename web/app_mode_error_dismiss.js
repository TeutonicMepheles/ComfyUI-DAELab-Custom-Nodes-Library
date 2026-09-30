import { app } from '/scripts/app.js';
import { api } from '/scripts/api.js';
import { installErrorDismiss } from './app_mode_error_dismiss.mjs?v=20260917-1';

let controller;
app.registerExtension({
    name: 'DAELab.AppModeErrorDismiss',
    setup() { controller = installErrorDismiss(document, api); },
    afterConfigureGraph() { controller?.reset(); },
});
