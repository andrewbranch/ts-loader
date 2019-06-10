import { Chalk } from 'chalk';
import * as path from 'path';
import * as semver from 'semver';
import * as typescript from 'typescript';
import * as webpack from 'webpack';

import { ConfigFile, LoaderOptions, WebpackError } from './interfaces';
import * as logger from './logger';
import { formatErrors, getPossiblyRenamedFilePath } from './utils';

export function getConfigFile(
  compiler: typeof typescript,
  colors: Chalk,
  loader: webpack.loader.LoaderContext,
  loaderOptions: LoaderOptions,
  compilerCompatible: boolean,
  log: logger.Logger,
  compilerDetailsLogMessage: string
) {
  const configFilePath = findConfigFile(
    compiler,
    path.dirname(loader.resourcePath),
    loaderOptions.configFile
  );
  let configFileError: WebpackError | undefined;
  let configFile: ConfigFile;

  if (configFilePath !== undefined) {
    if (compilerCompatible) {
      log.logInfo(`${compilerDetailsLogMessage} and ${configFilePath}`);
    } else {
      log.logInfo(`ts-loader: Using config file at ${configFilePath}`);
    }

    configFile = compiler.readConfigFile(configFilePath, compiler.sys.readFile);

    if (configFile.error !== undefined) {
      configFileError = formatErrors(
        [configFile.error],
        loaderOptions,
        colors,
        compiler,
        { file: configFilePath },
        loader.context
      )[0];
    }
  } else {
    if (compilerCompatible) {
      log.logInfo(compilerDetailsLogMessage);
    }

    configFile = {
      config: {
        compilerOptions: {},
        files: []
      }
    };
  }

  if (configFileError === undefined) {
    configFile.config.compilerOptions = Object.assign(
      {},
      configFile.config.compilerOptions,
      loaderOptions.compilerOptions
    );
  }

  return {
    configFilePath,
    configFile,
    configFileError
  };
}

/**
 * Find a tsconfig file by name or by path.
 * By name, the tsconfig.json is found using the same method as `tsc`, starting in the current
 * directory and continuing up the parent directory chain.
 * By path, the file will be found by resolving the given path relative to the requesting entry file.
 *
 * @param compiler The TypeScript compiler instance
 * @param requestDirPath The directory in which the entry point requesting the tsconfig.json lies
 * @param configFile The tsconfig file name to look for or a path to that file
 * @return The absolute path to the tsconfig file, undefined if none was found.
 */
function findConfigFile(
  compiler: typeof typescript,
  requestDirPath: string,
  configFile: string
): string | undefined {
  // If `configFile` is an absolute path, return it right away
  if (path.isAbsolute(configFile)) {
    return compiler.sys.fileExists(configFile) ? configFile : undefined;
  }

  // If `configFile` is a relative path, resolve it.
  // We define a relative path as: starts with
  // one or two dots + a common directory delimiter
  if (configFile.match(/^\.\.?(\/|\\)/) !== null) {
    const resolvedPath = path.resolve(requestDirPath, configFile);
    return compiler.sys.fileExists(resolvedPath) ? resolvedPath : undefined;

    // If `configFile` is a file name, find it in the directory tree
  } else {
    while (true) {
      const fileName = path.join(requestDirPath, configFile);
      if (compiler.sys.fileExists(fileName)) {
        return fileName;
      }
      const parentPath = path.dirname(requestDirPath);
      if (parentPath === requestDirPath) {
        break;
      }
      requestDirPath = parentPath;
    }

    return undefined;
  }
}

export function getConfigParseResult(
  compiler: typeof typescript,
  configFile: ConfigFile,
  basePath: string,
  configFilePath: string | undefined,
  loaderOptions: LoaderOptions
) {
  const configParseResult = compiler.parseJsonConfigFileContent(
    configFile.config,
    getSuffixAppendingParseConfigHost(compiler.sys, loaderOptions),
    basePath
  );

  if (semver.gte(compiler.version, '3.5.0')) {
    // set internal options.configFilePath flag on options to denote that we read this from a file
    configParseResult.options = Object.assign({}, configParseResult.options, {
      configFilePath
    });
  }

  return configParseResult;
}

function getSuffixAppendingParseConfigHost(
  sys: typescript.System,
  loaderOptions: LoaderOptions
): typescript.ParseConfigHost {
  if (
    !loaderOptions.appendTsSuffixTo.length &&
    !loaderOptions.appendTsxSuffixTo.length
  ) {
    return sys;
  }

  return {
    useCaseSensitiveFileNames: sys.useCaseSensitiveFileNames,
    fileExists: mapArg(sys.fileExists, transformFileName),
    readFile: mapArg(sys.readFile, transformFileName),
    readDirectory: (rootDir, extensions, ...rest) => {
      const allFiles = sys.readDirectory(rootDir);
      const customExtensions = allFiles.reduce((exts: string[], fileName) => {
        const renamed = transformFileName(fileName);
        if (
          renamed !== fileName &&
          extensions.indexOf(path.extname(renamed).toLowerCase()) > -1
        ) {
          const ext = path.extname(fileName).toLowerCase();
          if (ext) {
            exts.push(ext);
          }
        }
        return exts;
      }, []);

      return sys
        .readDirectory(rootDir, extensions.concat(customExtensions), ...rest)
        .map(transformFileName);
    }
  };

  function transformFileName(rawFileName: string) {
    return getPossiblyRenamedFilePath(rawFileName, loaderOptions);
  }
}

function mapArg<T, U>(toWrap: (x: T) => U, wrapWith: (x: T) => T): (x: T) => U {
  return x => toWrap(wrapWith(x));
}
