import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
export default tseslint.config({ignores:['third_party/**','dist/**','node_modules/**','PRD/**','src-tauri/**','public/**','.downloads/**','.quality/**','deliverables/**']},js.configs.recommended,...tseslint.configs.recommended,{files:['src/**/*.{ts,tsx}'],languageOptions:{globals:globals.browser},rules:{'@typescript-eslint/no-explicit-any':'off','@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_',varsIgnorePattern:'^_'}]}},{files:['scripts/**/*.mjs','*.js'],languageOptions:{globals:globals.node}});
