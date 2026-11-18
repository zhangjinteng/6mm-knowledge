import { existsSync } from 'node:fs';
import { createRequire, register } from 'node:module';
import { pathToFileURL } from 'node:url';

const VendorServiceRootUrl = new URL('../../../vendor/service/', import.meta.url);
const VendorGlobalRootUrl = new URL('../../../vendor/global/', import.meta.url);
const VendorSdkOtelRootUrl = new URL('../../../vendor/sdk/otel/', import.meta.url);
const VendorSdkStorageRootUrl = new URL('../../../vendor/sdk/storage/', import.meta.url);
const VendorSdkSandboxAdapterRootUrl = new URL(
  '../../../vendor/sdk/sandbox-adapter/',
  import.meta.url
);
const VendorResolverRegistered = Symbol.for('fastify.fastgptVendorResolverRegistered');
const requireFromVendorResolver = createRequire(import.meta.url);
const EsbuildModuleUrl = pathToFileURL(requireFromVendorResolver.resolve('esbuild')).href;

function normalizeVendorModulePath(path: string) {
  const normalized = path.replace(/^\/+/, '').replace(/\.ts$/, '');

  return `${normalized}.ts`;
}

function resolveVendorModule(rootUrl: URL, path: string) {
  const fileUrl = new URL(normalizeVendorModulePath(path), rootUrl);
  if (existsSync(fileUrl)) {
    return fileUrl.href;
  }

  const indexUrl = new URL(`${path.replace(/^\/+/, '').replace(/\/+$/, '')}/index.ts`, rootUrl);
  if (existsSync(indexUrl)) {
    return indexUrl.href;
  }

  return fileUrl.href;
}

function sdkSourceModule(rootUrl: URL, path: string) {
  return new URL(path, rootUrl).href;
}

function resolveFastGptSdkVendorSpecifier(specifier: string) {
  if (specifier === '@fastgpt-sdk/otel') {
    return sdkSourceModule(VendorSdkOtelRootUrl, 'dist/index.mjs');
  }

  if (specifier.startsWith('@fastgpt-sdk/otel/')) {
    const subpath = specifier.slice('@fastgpt-sdk/otel/'.length);
    const entryMap: Record<string, string> = {
      logger: 'dist/logger-entry.mjs',
      metrics: 'dist/metrics-entry.mjs',
      tracing: 'dist/tracing-entry.mjs'
    };

    return sdkSourceModule(VendorSdkOtelRootUrl, entryMap[subpath] ?? `dist/${subpath}.mjs`);
  }

  if (specifier === '@fastgpt-sdk/storage') {
    return sdkSourceModule(VendorSdkStorageRootUrl, 'dist/index.js');
  }

  if (specifier.startsWith('@fastgpt-sdk/storage/')) {
    return sdkSourceModule(
      VendorSdkStorageRootUrl,
      `dist/${specifier.slice('@fastgpt-sdk/storage/'.length)}.js`
    );
  }

  if (specifier === '@fastgpt-sdk/sandbox-adapter') {
    return sdkSourceModule(VendorSdkSandboxAdapterRootUrl, 'dist/index.js');
  }

  if (specifier.startsWith('@fastgpt-sdk/sandbox-adapter/')) {
    return sdkSourceModule(
      VendorSdkSandboxAdapterRootUrl,
      `dist/${specifier.slice('@fastgpt-sdk/sandbox-adapter/'.length)}.js`
    );
  }

  return specifier;
}

function registerFastGptVendorResolver() {
  const globalScope = globalThis as Record<symbol, boolean | undefined>;
  if (globalScope[VendorResolverRegistered]) {
    return;
  }

  globalScope[VendorResolverRegistered] = true;

  const loaderSource = `
    import { statSync } from 'node:fs';
    import { readFile } from 'node:fs/promises';
    import { createRequire } from 'node:module';
    import { fileURLToPath, pathToFileURL } from 'node:url';
    import esbuildModule from ${JSON.stringify(EsbuildModuleUrl)};

    const vendorServiceRootUrl = ${JSON.stringify(VendorServiceRootUrl.href)};
    const vendorGlobalRootUrl = ${JSON.stringify(VendorGlobalRootUrl.href)};
    const vendorSdkOtelRootUrl = ${JSON.stringify(VendorSdkOtelRootUrl.href)};
    const vendorSdkStorageRootUrl = ${JSON.stringify(VendorSdkStorageRootUrl.href)};
    const vendorSdkSandboxAdapterRootUrl = ${JSON.stringify(VendorSdkSandboxAdapterRootUrl.href)};
    const requireFromFastifyVendor = createRequire(${JSON.stringify(import.meta.url)});
    const { transform } = esbuildModule;

    function sdkSourceModule(rootUrl, path) {
      return new URL(path, rootUrl).href;
    }

    function resolveFastGptSdkVendorSpecifier(specifier) {
      if (specifier === '@fastgpt-sdk/otel') {
        return sdkSourceModule(vendorSdkOtelRootUrl, 'dist/index.mjs');
      }

      if (specifier.startsWith('@fastgpt-sdk/otel/')) {
        const subpath = specifier.slice('@fastgpt-sdk/otel/'.length);
        const entryMap = {
          logger: 'dist/logger-entry.mjs',
          metrics: 'dist/metrics-entry.mjs',
          tracing: 'dist/tracing-entry.mjs'
        };

        return sdkSourceModule(vendorSdkOtelRootUrl, entryMap[subpath] ?? \`dist/\${subpath}.mjs\`);
      }

      if (specifier === '@fastgpt-sdk/storage') {
        return sdkSourceModule(vendorSdkStorageRootUrl, 'dist/index.js');
      }

      if (specifier.startsWith('@fastgpt-sdk/storage/')) {
        return sdkSourceModule(vendorSdkStorageRootUrl, \`dist/\${specifier.slice('@fastgpt-sdk/storage/'.length)}.js\`);
      }

      if (specifier === '@fastgpt-sdk/sandbox-adapter') {
        return sdkSourceModule(vendorSdkSandboxAdapterRootUrl, 'dist/index.js');
      }

      if (specifier.startsWith('@fastgpt-sdk/sandbox-adapter/')) {
        return sdkSourceModule(
          vendorSdkSandboxAdapterRootUrl,
          \`dist/\${specifier.slice('@fastgpt-sdk/sandbox-adapter/'.length)}.js\`
        );
      }

      return specifier;
    }

    function isVendorSourceUrl(url) {
      return (
        (url.startsWith(vendorServiceRootUrl) || url.startsWith(vendorGlobalRootUrl)) &&
        (url.endsWith('.ts') || url.endsWith('.tsx'))
      );
    }

    function isVendorJsonUrl(url) {
      return (
        (url.startsWith(vendorServiceRootUrl) || url.startsWith(vendorGlobalRootUrl)) &&
        url.endsWith('.json')
      );
    }

    function isVendorRootUrl(url) {
      return url.startsWith(vendorServiceRootUrl) || url.startsWith(vendorGlobalRootUrl);
    }

    function hasRuntimeModuleExtension(url) {
      return /\\.(?:cjs|cts|js|json|jsx|mjs|mts|node|ts|tsx)$/i.test(new URL(url).pathname);
    }

    function fileUrlIsFile(url) {
      try {
        return statSync(new URL(url)).isFile();
      } catch {
        return false;
      }
    }

    function directoryIndexUrl(baseUrl, filename) {
      return new URL(filename, baseUrl.endsWith('/') ? baseUrl : \`\${baseUrl}/\`).href;
    }

    function resolveVendorSourceSpecifier(specifier, parentURL) {
      if (!parentURL || !isVendorRootUrl(parentURL)) return;
      if (!specifier.startsWith('.') && !specifier.startsWith('/')) return;

      const baseUrl = (() => {
        try {
          return new URL(specifier, parentURL).href;
        } catch {
          return;
        }
      })();
      if (!baseUrl) return;

      if (fileUrlIsFile(baseUrl)) {
        return baseUrl;
      }

      if (hasRuntimeModuleExtension(baseUrl)) {
        return;
      }

      const candidates = [
        \`\${baseUrl}.ts\`,
        \`\${baseUrl}.tsx\`,
        directoryIndexUrl(baseUrl, 'index.ts'),
        directoryIndexUrl(baseUrl, 'index.tsx')
      ];

      return candidates.find(fileUrlIsFile);
    }

    function isBarePackageSpecifier(specifier) {
      return (
        !specifier.startsWith('.') &&
        !specifier.startsWith('/') &&
        !specifier.startsWith('#') &&
        !/^[a-zA-Z][a-zA-Z\\d+.-]*:/.test(specifier)
      );
    }

    function shouldFallbackVendorPackageResolve(specifier, parentURL) {
      return Boolean(parentURL && isVendorRootUrl(parentURL) && isBarePackageSpecifier(specifier));
    }

    function resolveVendorPackageSpecifier(specifier) {
      try {
        return pathToFileURL(requireFromFastifyVendor.resolve(specifier)).href;
      } catch {
        return;
      }
    }

    export async function resolve(specifier, context, nextResolve) {
      const resolved = resolveFastGptSdkVendorSpecifier(specifier);
      if (resolved !== specifier) {
        return {
          url: resolved,
          shortCircuit: true
        };
      }

      const vendorSourceUrl = resolveVendorSourceSpecifier(specifier, context.parentURL);
      if (vendorSourceUrl) {
        return {
          url: vendorSourceUrl,
          shortCircuit: true
        };
      }

      // Vendor 源码里存在 dayjs/plugin/utc 这类 CommonJS 子路径，Node ESM 默认不会补 .js。
      if (shouldFallbackVendorPackageResolve(specifier, context.parentURL)) {
        try {
          return await nextResolve(specifier, context);
        } catch (error) {
          const vendorPackageUrl = resolveVendorPackageSpecifier(specifier);
          if (vendorPackageUrl) {
            return {
              url: vendorPackageUrl,
              shortCircuit: true
            };
          }

          throw error;
        }
      }

      return nextResolve(specifier, context);
    }

    export async function load(url, context, nextLoad) {
      if (isVendorJsonUrl(url)) {
        const source = await readFile(new URL(url), 'utf8');
        const jsonData = JSON.parse(source);
        const namedExports =
          jsonData && typeof jsonData === 'object' && !Array.isArray(jsonData)
            ? Object.keys(jsonData)
                .filter((key) => /^[A-Za-z_$][\\w$]*$/.test(key))
                .map((key) => \`export const \${key} = data[\${JSON.stringify(key)}];\`)
                .join('\\n')
            : '';

        return {
          format: 'module',
          source: \`const data = \${source};\\nexport default data;\\n\${namedExports}\`,
          shortCircuit: true
        };
      }

      if (!isVendorSourceUrl(url)) {
        return nextLoad(url, context);
      }

      const source = await readFile(new URL(url), 'utf8');
      const result = await transform(source, {
        format: 'esm',
        loader: url.endsWith('.tsx') ? 'tsx' : 'ts',
        sourcemap: 'inline',
        sourcefile: fileURLToPath(url),
        target: 'es2022'
      });

      return {
        format: 'module',
        source: result.code,
        shortCircuit: true
      };
    }
  `;

  register(`data:text/javascript,${encodeURIComponent(loaderSource)}`, import.meta.url);
}

registerFastGptVendorResolver();

/**
 * 生成 fastify/vendor/service 下模块的文件 URL。
 */
export function fastGptServiceVendorModule(path: string) {
  return resolveVendorModule(VendorServiceRootUrl, path);
}

/**
 * 生成 fastify/vendor/global 下模块的文件 URL。
 */
export function fastGptGlobalVendorModule(path: string) {
  return resolveVendorModule(VendorGlobalRootUrl, path);
}

/**
 * 生成 fastify/vendor/sdk/otel 下模块的文件 URL。
 */
export function fastGptSdkOtelVendorModule(path: 'index' | 'logger' | 'metrics' | 'tracing' | string) {
  const entryMap: Record<string, string> = {
    index: 'dist/index.mjs',
    logger: 'dist/logger-entry.mjs',
    metrics: 'dist/metrics-entry.mjs',
    tracing: 'dist/tracing-entry.mjs'
  };

  return sdkSourceModule(VendorSdkOtelRootUrl, entryMap[path] ?? `dist/${path}.mjs`);
}

/**
 * 生成 fastify/vendor/sdk/storage 下模块的文件 URL。
 */
export function fastGptSdkStorageVendorModule(path: 'index' | string) {
  return sdkSourceModule(VendorSdkStorageRootUrl, path === 'index' ? 'dist/index.js' : `dist/${path}.js`);
}

/**
 * 生成 fastify/vendor/sdk/sandbox-adapter 下模块的文件 URL。
 */
export function fastGptSdkSandboxAdapterVendorModule(path: 'index' | string) {
  return sdkSourceModule(
    VendorSdkSandboxAdapterRootUrl,
    path === 'index' ? 'dist/index.js' : `dist/${path}.js`
  );
}

/**
 * 直接从 fastify/vendor/service 加载模块。
 */
export function importFastGptServiceVendorModule<T = any>(path: string): Promise<T> {
  return import(fastGptServiceVendorModule(path)) as Promise<T>;
}

/**
 * 直接从 fastify/vendor/global 加载模块。
 */
export function importFastGptGlobalVendorModule<T = any>(path: string): Promise<T> {
  return import(fastGptGlobalVendorModule(path)) as Promise<T>;
}
