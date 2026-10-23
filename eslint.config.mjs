import next from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
    { ignores: ["src/generated/**", ".next/**", "node_modules/**", "tools/**"] },
    ...next,
    ...nextTs,
];

export default config;
