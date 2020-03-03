import {
  BuilderContext,
  BuilderOutput,
  createBuilder,
  targetFromTargetString,
} from '@angular-devkit/architect';
import { JsonObject, tags } from '@angular-devkit/core';
import { resolve } from 'path';
import * as url from 'url';
import { runModuleAsObservableFork } from '../utils';
import { Schema as ProtractorBuilderOptions } from './schema';

function runCodeceptjs(root: string, options: ProtractorBuilderOptions): Promise<BuilderOutput> {
  const additionalProtractorConfig: Partial<ProtractorBuilderOptions> = {
    elementExplorer: options.elementExplorer,
    baseUrl: options.baseUrl,
    specs: options.specs && options.specs.length ? options.specs : undefined,
    suite: options.suite,
  };

  // TODO: Protractor manages process.exit itself, so this target will allways quit the
  // process. To work around this we run it in a subprocess.
  // https://github.com/angular/protractor/issues/4160
  return runModuleAsObservableFork(
    root,
    'protractor/built/launcher',
    'init',
    [resolve(root, options.protractorConfig), additionalProtractorConfig],
  ).toPromise() as Promise<BuilderOutput>;
}



// export { ProtractorBuilderOptions };

export async function execute(
  options: any,
  context: BuilderContext,
): Promise<BuilderOutput> {
  // ensure that only one of these options is used
  if (options.devServerTarget && options.baseUrl) {
    throw new Error(tags.stripIndents`
    The 'baseUrl' option cannot be used with 'devServerTarget'.
    When present, 'devServerTarget' will be used to automatically setup 'baseUrl' for Protractor.
    `);
  }

  let baseUrl = options.baseUrl;
  let server;
  if (options.devServerTarget) {
    const target = targetFromTargetString(options.devServerTarget);
    const serverOptions = await context.getTargetOptions(target);

    const overrides: Record<string, string | number | boolean> = { watch: false };
    if (options.host !== undefined) {
      overrides.host = options.host;
    } else if (typeof serverOptions.host === 'string') {
      options.host = serverOptions.host;
    } else {
      options.host = overrides.host = 'localhost';
    }

    if (options.port !== undefined) {
      overrides.port = options.port;
    } else if (typeof serverOptions.port === 'number') {
      options.port = serverOptions.port;
    }

    server = await context.scheduleTarget(target, overrides);
    const result = await server.result;
    if (!result.success) {
      return { success: false };
    }

    if (typeof serverOptions.publicHost === 'string') {
      let publicHost = serverOptions.publicHost as string;
      if (!/^\w+:\/\//.test(publicHost)) {
        publicHost = `${serverOptions.ssl
          ? 'https'
          : 'http'}://${publicHost}`;
      }
      const clientUrl = url.parse(publicHost);
      baseUrl = url.format(clientUrl);
    } else if (typeof result.baseUrl === 'string') {
      baseUrl = result.baseUrl;
    } else if (typeof result.port === 'number') {
      baseUrl = url.format({
        protocol: serverOptions.ssl ? 'https' : 'http',
        hostname: options.host,
        port: result.port.toString(),
      });
    }
  }

  // Like the baseUrl in protractor config file when using the API we need to add
  // a trailing slash when provide to the baseUrl.
  if (baseUrl && !baseUrl.endsWith('/')) {
    baseUrl += '/';
  }

  try {
    return await runCodeceptjs(context.workspaceRoot, { ...options, baseUrl });
  } catch {
    return { success: false };
  } finally {
    if (server) {
      await server.stop();
    }
  }
}

export default createBuilder<JsonObject>(execute);