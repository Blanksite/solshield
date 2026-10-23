import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        sol: {
          green: "#14F195",
          purple: "#9945FF",
          dark: "#0B0E14",
          card: "#121722",
        },
      },
    },
  },
  plugins: [],
};
export default config;
