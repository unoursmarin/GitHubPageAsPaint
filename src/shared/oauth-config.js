// Public values of the GitToPaint OAuth App and of its CORS relay (worker/). Neither is a secret.
// While either is empty the app only offers the personal access token sign-in.
export const OAUTH_CLIENT_ID = 'Ov23liw6rI74FmtSvy3Q';
export const OAUTH_RELAY_URL = 'https://gittopaint-oauth.raphaelchouchane.workers.dev';
// read:user for the profile, public_repo to write the drawing, workflow to install the daily job.
export const OAUTH_SCOPES = 'read:user public_repo workflow';

export const isOAuthConfigured = () => Boolean(OAUTH_CLIENT_ID && OAUTH_RELAY_URL);
