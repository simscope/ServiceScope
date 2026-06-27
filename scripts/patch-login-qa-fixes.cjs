const fs = require('fs');
const path = require('path');

const appFile = path.resolve(__dirname, '../src/App.tsx');
let content = fs.readFileSync(appFile, 'utf8');

if (!content.includes('const loginErrorMessageId =')) {
  content = content.replace(
    "  const [error, setError] = useState('');\n  const [isSigningIn, setIsSigningIn] = useState(false);",
    `  const [error, setError] = useState('');
  const [isSigningIn, setIsSigningIn] = useState(false);
  const loginErrorMessageId = 'login-error-message';
  const loginHasError = Boolean(error || authNotice);
  const clearLoginError = () => {
    if (error) setError('');
  };
  const updateEmail = (value: string) => {
    clearLoginError();
    setEmail(value);
  };
  const updatePassword = (value: string) => {
    clearLoginError();
    setPassword(value);
  };`,
  );
}

content = content.replace(
  '              onChange={(event) => setEmail(event.target.value)}',
  '              onChange={(event) => updateEmail(event.target.value)}',
);
content = content.replace(
  '              onChange={(event) => setPassword(event.target.value)}',
  '              onChange={(event) => updatePassword(event.target.value)}',
);

if (!content.includes("aria-describedby={loginHasError ? loginErrorMessageId : undefined}")) {
  content = content.replace(
    `              autoComplete="email"
              disabled={isSigningIn}`,
    `              autoComplete="email"
              aria-invalid={Boolean(error)}
              aria-describedby={loginHasError ? loginErrorMessageId : undefined}
              onInvalid={() => setError('Enter a valid email address.')}
              disabled={isSigningIn}`,
  );
  content = content.replace(
    `                  autoComplete="current-password"
                  disabled={isSigningIn}`,
    `                  autoComplete="current-password"
                  aria-invalid={Boolean(error)}
                  aria-describedby={loginHasError ? loginErrorMessageId : undefined}
                  disabled={isSigningIn}`,
  );
}

content = content.replace(
  `          {authNotice ? <p className="login-error">{authNotice}</p> : null}
          {error ? <p className="login-error">{error}</p> : null}`,
  `          {loginHasError ? (
            <p id={loginErrorMessageId} className="login-error" role="alert" aria-live="assertive">
              {error || authNotice}
            </p>
          ) : null}`,
);

fs.writeFileSync(appFile, content);
console.log('Login QA accessibility fixes patch applied.');
