<template>
  <router-view />
</template>

<style>
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

:root {
  /* Background Scale - Clean Light */
  --bg-primary: #f8fafc;
  --bg-secondary: #ffffff;
  --bg-tertiary: #f1f5f9;
  --bg-card: #ffffff;
  --bg-hover: #f1f5f9;
  --bg-elevated: #e2e8f0;

  /* Border Scale */
  --border-subtle: rgba(0, 0, 0, 0.04);
  --border-light: rgba(0, 0, 0, 0.08);
  --border-medium: rgba(0, 0, 0, 0.12);
  --border-strong: rgba(0, 0, 0, 0.2);

  /* Text Scale */
  --text-primary: #1e293b;
  --text-secondary: #475569;
  --text-tertiary: #94a3b8;
  --text-muted: #cbd5e1;

  /* Accent Colors - Refined */
  --accent-green: #10b981;
  --accent-green-dim: rgba(16, 185, 129, 0.1);
  --accent-red: #ef4444;
  --accent-red-dim: rgba(239, 68, 68, 0.1);
  --accent-gold: #f59e0b;
  --accent-gold-dim: rgba(245, 158, 11, 0.1);
  --accent-blue: #3b82f6;
  --accent-blue-dim: rgba(59, 130, 246, 0.1);
  --accent-purple: #8b5cf6;
  --accent-purple-dim: rgba(139, 92, 246, 0.1);

  /* Gradients */
  --gradient-gold: linear-gradient(135deg, #f59e0b, #fbbf24);
  --gradient-blue: linear-gradient(135deg, #3b82f6, #60a5fa);
  --gradient-green: linear-gradient(135deg, #10b981, #34d399);
  --gradient-red: linear-gradient(135deg, #ef4444, #f87171);
  --gradient-purple: linear-gradient(135deg, #8b5cf6, #a78bfa);

  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.04);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.07), 0 2px 4px -2px rgba(0, 0, 0, 0.05);
  --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.08), 0 4px 6px -4px rgba(0, 0, 0, 0.05);
  --shadow-glow-green: 0 4px 14px rgba(16, 185, 129, 0.15);
  --shadow-glow-red: 0 4px 14px rgba(239, 68, 68, 0.15);
  --shadow-glow-gold: 0 4px 14px rgba(245, 158, 11, 0.15);

  /* Spacing */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 20px;

  /* Transitions */
  --transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-base: 250ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-slow: 350ms cubic-bezier(0.4, 0, 0.2, 1);
}

/* Scrollbar */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: var(--text-muted);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--text-tertiary);
}

/* Element Plus Overrides */
.el-loading-mask {
  background-color: rgba(248, 250, 252, 0.85) !important;
  backdrop-filter: blur(4px);
}

.el-button {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 600;
  letter-spacing: 0.01em;
  border-radius: var(--radius-md);
  transition: all var(--transition-fast);
}

.el-input__wrapper,
.el-textarea__inner {
  background: var(--bg-secondary) !important;
  border: 1px solid var(--border-light) !important;
  border-radius: var(--radius-md) !important;
  box-shadow: none !important;
  transition: all var(--transition-fast);
}

.el-input__wrapper:hover,
.el-textarea__inner:hover {
  border-color: var(--border-medium) !important;
}

.el-input__wrapper.is-focus,
.el-textarea__inner:focus {
  border-color: var(--accent-blue) !important;
  box-shadow: 0 0 0 3px var(--accent-blue-dim) !important;
}

.el-select .el-input__wrapper {
  background: var(--bg-secondary) !important;
}

.el-slider__runway {
  background-color: var(--bg-elevated) !important;
  height: 6px !important;
  border-radius: 3px !important;
}

.el-slider__bar {
  background: var(--gradient-gold) !important;
  border-radius: 3px !important;
}

.el-slider__button {
  border: 2px solid var(--accent-gold) !important;
  background: var(--bg-card) !important;
  box-shadow: var(--shadow-md) !important;
}

.el-card {
  background: var(--bg-card) !important;
  border: 1px solid var(--border-light) !important;
  border-radius: var(--radius-lg) !important;
  box-shadow: var(--shadow-sm) !important;
  transition: all var(--transition-base);
}

.el-card:hover {
  border-color: var(--border-medium) !important;
  box-shadow: var(--shadow-md) !important;
}

.el-table {
  background: transparent !important;
  --el-table-header-bg-color: var(--bg-tertiary) !important;
  --el-table-row-hover-bg-color: var(--bg-hover) !important;
  --el-table-border-color: var(--border-light) !important;
}

.el-table th {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 600;
  font-size: 0.7rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-tertiary) !important;
}

.el-table td {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.82rem;
}

.el-tag {
  border-radius: var(--radius-sm) !important;
  font-weight: 600;
  font-size: 0.7rem;
}

.el-radio-button__inner {
  background: var(--bg-secondary) !important;
  border-color: var(--border-light) !important;
  color: var(--text-secondary) !important;
  font-weight: 600;
}

.el-radio-button__original-radio:checked + .el-radio-button__inner {
  background: var(--accent-blue-dim) !important;
  border-color: var(--accent-blue) !important;
  color: var(--accent-blue) !important;
  box-shadow: none !important;
}

.el-form-item__label {
  font-weight: 600;
  font-size: 0.8rem;
  color: var(--text-secondary) !important;
}

.el-empty {
  --el-empty-fill-color-0: var(--bg-tertiary);
  --el-empty-fill-color-1: var(--bg-elevated);
}

.el-empty__description {
  color: var(--text-tertiary) !important;
}

/* Animations */
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes pulse-soft {
  0%, 100% {
    opacity: 1;
    box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4);
  }
  50% {
    opacity: 0.8;
    box-shadow: 0 0 0 6px rgba(16, 185, 129, 0);
  }
}

@keyframes shimmer {
  0% {
    background-position: -200% 0;
  }
  100% {
    background-position: 200% 0;
  }
}
</style>
