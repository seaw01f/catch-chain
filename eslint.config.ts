import { defineConfig } from 'eslint/config'
import eslint from '@eslint/js'
import stylistic from '@stylistic/eslint-plugin'
import tseslint from 'typescript-eslint'

export default defineConfig(
  { ignores: ['dist', 'coverage'] },
  {
    files: ['**/*.ts', '**/*.cts', '**/*.mts'],
    extends: [
      eslint.configs.recommended,
      stylistic.configs.recommended,
      tseslint.configs.strictTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      'sort-imports': ['error', {
        ignoreCase: false,
        ignoreDeclarationSort: false,
        ignoreMemberSort: false,
        memberSyntaxSortOrder: ['none', 'all', 'multiple', 'single'],
        allowSeparatedGroups: false,
      }],
      'no-console': 'warn',
    },
  },
)
