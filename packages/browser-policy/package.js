Package.describe({
  summary: "Configure security policies enforced by the browser",
  version: "1.0.0"
});

Package.on_use(function (api) {
  api.use(['browser-policy-content', 'browser-policy-framing'], 'server');
  api.imply(['browser-policy-common'], 'server');
});

Package.on_test(function (api) {
  api.use(["tinytest", "browser-policy", "ejson"], "server");
  api.add_files("browser-policy-test.js", "server");
});
