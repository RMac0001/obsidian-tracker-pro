import typescript from "@rollup/plugin-typescript";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";

const isProd = process.env.BUILD === "production";

export default {
  input: "src/main.ts",
  output: {
    dir: ".",
    sourcemap: false,
    format: "cjs",
    exports: "default",
  },
  external: ["obsidian"],
  plugins: [
    typescript({ sourceMap: false, declaration: false }),
    nodeResolve({ browser: true }),
    commonjs(),
  ],
};
