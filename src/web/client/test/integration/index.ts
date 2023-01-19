/*
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 */

import * as path from "path";
import Mocha from "mocha";
import glob from "glob";
import * as vscode from "vscode";
//import NYC from 'nyc';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const NYC = require('nyc');

// Simulates the recommended config option
// extends: "@istanbuljs/nyc-config-typescript",
// eslint-disable-next-line @typescript-eslint/no-var-requires
const baseConfig = require('@istanbuljs/nyc-config-typescript')

// Recommended modules, loading them here to speed up NYC init
// and minimize risk of race condition
import 'ts-node/register';
import 'source-map-support/register';

async function addTests(): Promise<void> {
    // Ensure the dev-mode extension is activated
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await vscode.extensions
        .getExtension("microsoft-IsvExpTools.powerplatform-vscode")!
        .activate();

        const nyc = new NYC({
           ...baseConfig,
            cwd: path.join(__dirname, '..', '..', '..','..','..'),
            reporter: ['text-summary', 'html'],
            all: true,
            silent: false,
            instrument: true,
            hookRequire: true,
            hookRunInContext: true,
            hookRunInThisContext: true,
            include: [  "**/*.ts" ],
            exclude: [  "**/*.test.ts" ],
          });
          await nyc.wrap();

          const myFilesRegex = /powerplatform-vscode\/dist/;
  const filterFn = myFilesRegex.test.bind(myFilesRegex);
  if (Object.keys(require.cache).filter(filterFn).length > 1) {
    console.warn('NYC initialized after modules were loaded', Object.keys(require.cache).filter(filterFn));
  }

          await nyc.createTempDirectory();
    // Create the mocha test
    const mocha = new Mocha({
        ui: "tdd",
        color: true, timeout: 10 * 1000,
    });

    const testsRoot = path.resolve(__dirname, "..");

    return new Promise((resolve, reject) => {
        glob("**/**.test.js", { cwd: testsRoot }, (err, files) => {
            if (err) {
                return reject(err);
            }

            // Add files to the test suite
            files.forEach((f) => mocha.addFile(path.resolve(testsRoot, f)));

            try {
                // Run the mocha test
                mocha.run(async (failures) => {
                    if (failures > 0) {
                        reject(new Error(`${failures} tests failed.`));
                    } else {
                        resolve();
                        await nyc.writeCoverageFile();
                        console.log(await captureStdout(nyc.report.bind(nyc)));
                    }
                });
            } catch (err) {
                console.error(err);
                reject(err);
            }
        });
    });
}

export async function run(): Promise<void> {
    await addTests();
}

async function captureStdout(fn:any) {
    // eslint-disable-next-line prefer-const
    let w = process.stdout.write, buffer = '';
    process.stdout.write = (s) => { buffer = buffer + s; return true; };
    await fn();
    process.stdout.write = w;
    return buffer;
  }