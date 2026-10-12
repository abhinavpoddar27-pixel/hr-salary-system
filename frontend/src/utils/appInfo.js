// P8-06: one product name + the build's version (vite.config.js `define`). No hard-coded version.
/* global __APP_VERSION__, __BUILD_SHA__ */
export const PRODUCT_NAME = 'HR & Salary System'
export const COMPANY_LINE = 'Indriyan Beverages · Asian Lakto'
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'
export const BUILD_SHA = typeof __BUILD_SHA__ !== 'undefined' ? __BUILD_SHA__ : 'dev'
export const VERSION_TEXT = `v${APP_VERSION} · ${BUILD_SHA}`
