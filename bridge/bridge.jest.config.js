module.exports = {
    name: "bridge",
    displayName: "bridge",

    // NOTE: if you don't set this correctly then when you reference
    // it later in a path string you'll get a confusing error message.
    // It says something like' Module <rootDir>/config/polyfills.js in
    // the setupFiles option was not found.'
    rootDir: "./../",
    testPathIgnorePatterns: ["/node_modules/", "/dist/", "/test/aws-dependent"],
    testMatch: ["**/*/*.spec.{ts,tsx}"],
    coverageDirectory: "coverage",
    coverageReporters: ["lcov"],
    coveragePathIgnorePatterns: ["/node_modules/"],
    coverageThreshold: {
        global: { lines: 99.8, statements: 99.8, functions: 99.8, branches: 99.8 },
    }
};
