/**********************************************************************
 * Copyright (C) 2024-2025 Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 ***********************************************************************/

import * as extensionApi from '@podman-desktop/api';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { satisfies, coerce } from 'semver';
import type { ContainerProviderConnection } from '@podman-desktop/api';
import { env } from '@podman-desktop/api';

function getMachineProviderEnv(connection: extensionApi.ContainerProviderConnection): string {
  switch (connection.vmType) {
    case 'wsl':
    case 'Wsl':
      return 'wsl';
    case 'hyperv':
      return 'hyperv';
    case 'libkrun':
    case 'GPU enabled (LibKrun)':
      return 'libkrun';
    case 'applehv':
    case 'default (Apple HyperVisor)':
      return 'applehv';
    default:
      throw new Error('Podman machine not supported on Linux');
  }
}

function getPodmanMachineName(connection: ContainerProviderConnection): string {
  const runningConnectionName = connection.name;
  if (runningConnectionName.startsWith('Podman Machine')) {
    const machineName = runningConnectionName.replace(/Podman Machine\s*/, 'podman-machine-');
    if (machineName.endsWith('-')) {
      return `${machineName}default`;
    }
    return machineName;
  } else {
    return runningConnectionName;
  }
}

// Async function to get machine information in JSON format
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getMachineInfo(connection: extensionApi.ContainerProviderConnection): Promise<any> {
  const { stdout: machineInfoJson } = await extensionApi.process.exec(
    getPodmanCli(),
    ['machine', 'info', '--format', 'json'],
    {
      env: {
        CONTAINERS_MACHINE_PROVIDER: getMachineProviderEnv(connection),
      },
    },
  );
  return JSON.parse(machineInfoJson);
}

// Read the machine configuration and error out if we are uanble to read it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readMachineConfig(machineConfigDir: string, currentMachine: string): Promise<any> {
  const filepath = path.join(machineConfigDir, `${currentMachine}.json`);

  // Check if the file exists before reading it
  if (!fs.existsSync(filepath)) {
    throw new Error(`Machine config file ${filepath} does not exist.`);
  }

  const machineConfigJson = await fs.promises.readFile(filepath, 'utf8');
  return JSON.parse(machineConfigJson);
}

// Check if the current podman machine is rootful
export async function isPodmanMachineRootful(connection: extensionApi.ContainerProviderConnection): Promise<boolean> {
  try {
    const machineInfo = await getMachineInfo(connection);
    const machineConfig = await readMachineConfig(machineInfo.Host.MachineConfigDir, getPodmanMachineName(connection));

    // If you are on Podman Machine 4.9.0 with applehv activated, the rootful key will be located
    // in the root of the JSON object.
    // If on 5.0.0, the rootful key will be located in the "HostUser" object.
    if (machineConfig?.HostUser?.Rootful) {
      // 5.0.0 check first
      return Boolean(machineConfig.HostUser.Rootful);
    } else if (machineConfig?.Rootful) {
      // 4.9.0 check
      console.log(
        'Rootful key found in root object of the machine config file, you could be on Podman Machine v4, it is recommended to upgrade to v5.',
      );
      return Boolean(machineConfig.Rootful);
    } else {
      console.error('No Rootful key found in machine config file, there should be one.');
      return false;
    }
  } catch (error) {
    console.error('Error when checking rootful machine status:', error);
    return false; // Ensure function returns a boolean even in case of error
  }
}

// Check if the current podman machine is v5 or above
export async function isPodmanV5Machine(connection: extensionApi.ContainerProviderConnection): Promise<boolean> {
  try {
    const machineInfo = await getMachineInfo(connection);

    const ver = machineInfo.Version.Version;
    // Attempt to parse the version, handling undefined if it fails
    const coercedVersion = coerce(ver);
    if (!coercedVersion) {
      // Handle the case where the version could not be coerced successfully
      console.error('Unable to parse Podman machine version:', ver);
      return false;
    }
    // Check if the coerced version satisfies the range, including pre-release versions,
    // this means 5.0.0-dev will pass
    return satisfies(coercedVersion, '>=5.0.0', { includePrerelease: true });
  } catch (error) {
    console.error('Error when checking Podman machine version:', error);
    return false; // Ensure function returns a boolean even in case of error
  }
}

export async function checkPrereqs(connection: extensionApi.ContainerProviderConnection): Promise<string | undefined> {
  // Podman Machine checks are applicable to non-Linux platforms only
  if (!isLinux()) {
    const isPodmanV5 = await isPodmanV5Machine(connection);
    if (!isPodmanV5) {
      return 'Podman v5.0 or higher is required to build disk images.';
    }

    const isRootful = await isPodmanMachineRootful(connection);
    if (!isRootful) {
      return 'The podman machine is not set as rootful. Please recreate the podman machine with rootful privileges set and try again.';
    }
  }
  return undefined;
}

// Below functions are borrowed from the podman extension
function getPodmanCli(): string {
  const customBinaryPath = getCustomBinaryPath();
  if (customBinaryPath) {
    return customBinaryPath;
  }

  if (isWindows()) {
    return 'podman.exe';
  }
  return 'podman';
}

function getCustomBinaryPath(): string | undefined {
  return extensionApi.configuration.getConfiguration('podman').get('binary.path');
}

export function isWindows(): boolean {
  return env.isWindows;
}

export function isLinux(): boolean {
  return env.isLinux;
}

export function isMac(): boolean {
  return env.isMac;
}

export function getArch(): string {
  return os.arch();
}

export function isArm(): boolean {
  return os.arch() === 'arm64';
}

export function isX86(): boolean {
  return os.arch() === 'x64';
}

// Get the GID and UID of the current user and return in the format gid:uid
// in order for this to work, we must get this information from process.exec
// since there is no native way via node
export async function getUidGid(): Promise<string> {
  const { stdout: uidOutput } = await extensionApi.process.exec('id', ['-u']);
  const { stdout: gidOutput } = await extensionApi.process.exec('id', ['-g']);
  return `${uidOutput.trim()}:${gidOutput.trim()}`;
}
