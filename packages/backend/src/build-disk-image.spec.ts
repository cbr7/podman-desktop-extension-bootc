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

import { beforeEach, expect, test, vi } from 'vitest';
import os from 'node:os';
import {
  buildExists,
  createBuilderImageOptions,
  createPodmanCLIRunCommand,
  getBuilder,
  getUnusedName,
  createBuildConfigJSON,
  buildDiskImage,
} from './build-disk-image';
import { bootcImageBuilderCentos, bootcImageBuilderRHEL } from './constants';
import type { ContainerInfo, Configuration } from '@podman-desktop/api';
import * as extensionApi from '@podman-desktop/api';
import { containerEngine } from '@podman-desktop/api';
import type { BootcBuildInfo, BuildConfig } from '/@shared/src/models/bootc';
import * as fs from 'node:fs';
import type { History } from './history';
import path, { resolve } from 'node:path';
import { getContainerEngine } from './container-utils';

const configurationGetConfigurationMock = vi.fn();

const config: Configuration = {
  get: configurationGetConfigurationMock,
  has: () => true,
  update: vi.fn(),
};

vi.mock('node:fs');

vi.mock('@podman-desktop/api', async () => {
  return {
    env: {
      createTelemetryLogger: vi.fn(),
    },
    containerEngine: {
      listContainers: vi.fn().mockReturnValue([]),
    },
    configuration: {
      getConfiguration: (): Configuration => config,
    },
    window: {
      withProgress: vi.fn(),
      showErrorMessage: vi.fn(),
    },
    ProgressLocation: {
      TASK_WIDGET: 'TASK_WIDGET',
    },
  };
});

vi.mock('./container-utils');

vi.mock('./machine-utils');

vi.mock('@crc-org/macadam.js', () => {
  const mockInstance = {
    init: vi.fn(),
    createVm: vi.fn(),
    listVms: vi.fn(),
  };
  return {
    Macadam: vi.fn(() => mockInstance),
  };
});

beforeEach(() => {
  vi.resetAllMocks();
});

test('check image builder options', async () => {
  const name = 'my-image';
  const build = {
    image: 'test-image',
    tag: 'not-latest',
    type: ['raw'],
    arch: 'amd',
    folder: '/output-folder',
  } as BootcBuildInfo;
  const options = createBuilderImageOptions(name, build);

  expect(options).toBeDefined();
  expect(options.name).toEqual(name);
  expect(options.Image).toEqual(bootcImageBuilderCentos);
  expect(options.HostConfig).toBeDefined();
  if (options.HostConfig?.Binds) {
    expect(options.HostConfig.Binds[0]).toEqual(build.folder + ':/output/');
    expect(options.HostConfig.Binds[1]).toEqual('/var/lib/containers/storage:/var/lib/containers/storage');
  }
  expect(options.Cmd).toEqual([
    build.image + ':' + build.tag,
    '--output',
    '/output/',
    '--local',
    '--progress',
    'verbose',
    '--type',
    build.type[0],
    '--target-arch',
    build.arch,
  ]);
});

test('check image builder with multiple types', async () => {
  const name = 'my-image';
  const build = {
    image: 'test-image',
    tag: '1.0',
    type: ['raw', 'vmdk'],
    arch: 'amd',
    folder: '/output-folder',
  } as BootcBuildInfo;
  const options = createBuilderImageOptions(name, build);

  expect(options).toBeDefined();
  expect(options.name).toEqual(name);
  expect(options.Image).toEqual(bootcImageBuilderCentos);
  expect(options.HostConfig).toBeDefined();
  if (options.HostConfig?.Binds) {
    expect(options.HostConfig.Binds[0]).toEqual(build.folder + ':/output/');
    expect(options.HostConfig.Binds[1]).toEqual('/var/lib/containers/storage:/var/lib/containers/storage');
  }
  expect(options.Cmd).toEqual([
    build.image + ':' + build.tag,
    '--output',
    '/output/',
    '--local',
    '--progress',
    'verbose',
    '--type',
    build.type[0],
    '--type',
    build.type[1],
    '--target-arch',
    build.arch,
  ]);
});

test('check image builder does not include target arch', async () => {
  const build = {
    image: 'test-image',
    type: ['vmdk'],
  } as BootcBuildInfo;
  const options = createBuilderImageOptions('my-image', build);

  expect(options).toBeDefined();
  expect(options.Cmd).not.toContain('--target-arch');
});

test('check image builder includes target arch for anaconda-iso', async () => {
  const build = {
    image: 'test-image',
    type: ['anaconda-iso'],
    arch: 'amd',
  } as BootcBuildInfo;
  const options = createBuilderImageOptions('my-image', build);

  expect(options).toBeDefined();
  expect(options.Cmd).toContain('--target-arch');
});

test('check that if xfs is passed into filesystem, it is included in the command', async () => {
  const build = {
    image: 'test-image',
    type: ['vmdk'],
    arch: 'amd',
    filesystem: 'xfs',
  } as BootcBuildInfo;
  const options = createBuilderImageOptions('my-image', build);

  expect(options).toBeDefined();
  expect(options.Cmd).toContain('--rootfs');
  expect(options.Cmd).toContain(build.filesystem);
});

test('check that if ext4 is passed into the filesystem, it is included in the command', async () => {
  const build = {
    image: 'test-image',
    type: ['vmdk'],
    arch: 'amd',
    filesystem: 'ext4',
  } as BootcBuildInfo;
  const options = createBuilderImageOptions('my-image', build);

  expect(options).toBeDefined();
  expect(options.Cmd).toContain('--rootfs');
  expect(options.Cmd).toContain(build.filesystem);
});

test('check that if btrfs is passed into the filesystem, it is included in the command', async () => {
  const build = {
    image: 'test-image',
    type: ['vmdk'],
    arch: 'amd',
    filesystem: 'btrfs',
  } as BootcBuildInfo;
  const options = createBuilderImageOptions('my-image', build);

  expect(options).toBeDefined();
  expect(options.Cmd).toContain('--rootfs');
  expect(options.Cmd).toContain(build.filesystem);
});

test('test if a fake filesystem foobar is passed into filesystem, it is not included in the command', async () => {
  const build = {
    image: 'test-image',
    type: ['vmdk'],
    arch: 'amd',
    filesystem: 'foobar',
  } as BootcBuildInfo;
  const options = createBuilderImageOptions('my-image', build);

  expect(options).toBeDefined();
  expect(options.Cmd).not.toContain('--rootfs');
});

test('test if blank string is passed into filesystem, it is not included in the command', async () => {
  const build = {
    image: 'test-image',
    type: ['vmdk'],
    arch: 'amd',
    filesystem: '',
  } as BootcBuildInfo;
  const options = createBuilderImageOptions('my-image', build);

  expect(options).toBeDefined();
  expect(options.Cmd).not.toContain('--rootfs');
});

test('test specified builder is used', async () => {
  const builder = 'foo-builder';
  const build = {
    image: 'test-image',
    type: ['vmdk'],
  } as BootcBuildInfo;
  const options = createBuilderImageOptions('my-image', build, builder);

  expect(options).toBeDefined();
  expect(options.Image).toEqual(builder);
});

test('check we pick unused container name', async () => {
  const basename = 'test';
  let name = await getUnusedName(basename);
  expect(name).toEqual(basename);

  vi.spyOn(containerEngine, 'listContainers').mockReturnValue([{ Names: ['test'] }] as unknown as Promise<
    ContainerInfo[]
  >);
  name = await getUnusedName(basename);
  expect(name).toEqual(basename + '-2');

  vi.spyOn(containerEngine, 'listContainers').mockReturnValue([
    { Names: ['test'] },
    { Names: ['/test-2'] },
  ] as unknown as Promise<ContainerInfo[]>);
  name = await getUnusedName(basename);
  expect(name).toEqual(basename + '-3');
});

test('check build exists', async () => {
  const folder = '/output';

  // mock two existing builds on disk: qcow2 and vmdk
  const existsList: string[] = [resolve(folder, 'qcow2/disk.qcow2'), resolve(folder, 'vmdk/disk.vmdk')];
  vi.spyOn(fs, 'existsSync').mockImplementation(f => {
    return existsList.includes(f.toString());
  });

  // vdmk exists
  let exists = await buildExists(folder, ['vmdk']);
  expect(exists).toEqual(true);

  // anaconda-iso does not
  exists = await buildExists(folder, ['anaconda-iso']);
  expect(exists).toEqual(false);

  // qcow2 exists
  exists = await buildExists(folder, ['qcow2']);
  expect(exists).toEqual(true);

  // vmdk and anaconda-iso exists (because of vdmk)
  exists = await buildExists(folder, ['vmdk', 'anaconda-iso']);
  expect(exists).toEqual(true);

  // anaconda-iso and raw don't exist
  exists = await buildExists(folder, ['anaconda-iso', 'raw']);
  expect(exists).toEqual(false);
});

test('check uses RHEL builder', async () => {
  configurationGetConfigurationMock.mockReturnValue('RHEL');

  const builder = await getBuilder();

  expect(builder).toBeDefined();
  expect(builder).toEqual(bootcImageBuilderRHEL);
});

test('check uses Centos builder', async () => {
  configurationGetConfigurationMock.mockReturnValue('CentOS');

  const builder = await getBuilder();

  expect(builder).toBeDefined();
  expect(builder).toEqual(bootcImageBuilderCentos);
});

test('create podman run CLI command', async () => {
  const name = 'test123-bootc-image-builder';
  const build = {
    image: 'test-image',
    tag: 'latest',
    type: ['raw'],
    arch: 'amd64',
    folder: '/Users/cdrage/bootc/qemutest4',
  } as BootcBuildInfo;

  const options = createBuilderImageOptions(name, build);
  const command = createPodmanCLIRunCommand(options);

  // Expect an array of the above
  const expectedCommand = [
    'podman',
    'run',
    '--rm',
    '--name',
    'test123-bootc-image-builder',
    '--tty',
    '--privileged',
    '--security-opt',
    'label=type:unconfined_t',
    '-v',
    '/Users/cdrage/bootc/qemutest4:/output/',
    '-v',
    '/var/lib/containers/storage:/var/lib/containers/storage',
    '--label',
    'bootc.image.builder=true',
    bootcImageBuilderCentos,
    'test-image:latest',
    '--output',
    '/output/',
    '--local',
    '--progress',
    'verbose',
    '--type',
    'raw',
    '--target-arch',
    'amd64',
  ];

  expect(command).toEqual(expectedCommand);
});

test('expect aws options to be included in the command for volume and paramters', async () => {
  const name = 'test123-bootc-image-builder';
  const build = {
    image: 'test-image',
    tag: 'latest',
    type: ['raw'],
    arch: 'amd64',
    folder: '/Users/cdrage/bootc/qemutest4',
    awsBucket: 'test-bucket',
    awsRegion: 'us-west-2',
    awsAmiName: 'test-ami',
  } as BootcBuildInfo;

  const options = createBuilderImageOptions(name, build);

  expect(options).toBeDefined();
  expect(options.HostConfig).toBeDefined();
  expect(options.HostConfig?.Binds).toBeDefined();
  if (options.HostConfig?.Binds) {
    expect(options.HostConfig.Binds[0]).toEqual(build.folder + ':/output/');
    expect(options.HostConfig.Binds[1]).toEqual('/var/lib/containers/storage:/var/lib/containers/storage');
    expect(options.HostConfig.Binds[2]).toEqual(path.join(os.homedir(), '.aws') + ':/root/.aws:ro');
  }

  // Check that the aws options are included in the command
  expect(options.Cmd).toContain('--aws-bucket');
  expect(options.Cmd).toContain(build.awsBucket);
  expect(options.Cmd).toContain('--aws-region');
  expect(options.Cmd).toContain(build.awsRegion);
  expect(options.Cmd).toContain('--aws-ami-name');
  expect(options.Cmd).toContain(build.awsAmiName);
});

test('test that if aws options are not provided, they are NOT included in the command', async () => {
  const name = 'test123-bootc-image-builder';
  const build = {
    image: 'test-image',
    tag: 'latest',
    type: ['raw'],
    arch: 'amd64',
    folder: '/Users/cdrage/bootc/qemutest4',
  } as BootcBuildInfo;

  const options = createBuilderImageOptions(name, build);

  expect(options).toBeDefined();
  expect(options.HostConfig).toBeDefined();
  expect(options.HostConfig?.Binds).toBeDefined();
  if (options.HostConfig?.Binds) {
    // Expect the length to ONLY be two. The first bind is the output folder, the second is the storage folder
    expect(options.HostConfig.Binds.length).toEqual(2);
    expect(options.HostConfig.Binds[0]).toEqual(build.folder + ':/output/');
    expect(options.HostConfig.Binds[1]).toEqual('/var/lib/containers/storage:/var/lib/containers/storage');
  }

  // Check that the aws options are NOT included in the command
  expect(options.Cmd).not.toContain('--aws-bucket');
  expect(options.Cmd).not.toContain('--aws-region');
  expect(options.Cmd).not.toContain('--aws-ami-name');
});

test('test if build config toml passed in, it will work', async () => {
  const name = 'test123-bootc-image-builder';
  const build = {
    image: 'test-image',
    tag: 'latest',
    type: ['raw'],
    arch: 'amd64',
    folder: '/foo/bar/qemutest4',
    buildConfigFilePath: '/foo/bar/baz/config.toml',
  } as BootcBuildInfo;

  const options = createBuilderImageOptions(name, build);

  expect(options).toBeDefined();
  expect(options.HostConfig).toBeDefined();
  expect(options.HostConfig?.Binds).toBeDefined();
  if (options.HostConfig?.Binds) {
    expect(options.HostConfig.Binds.length).toEqual(3);
    expect(options.HostConfig.Binds[0]).toEqual(build.folder + ':/output/');
    expect(options.HostConfig.Binds[1]).toEqual('/var/lib/containers/storage:/var/lib/containers/storage');
    expect(options.HostConfig.Binds[2]).toEqual(build.buildConfigFilePath + ':/config.toml:ro');
  }
});

test('test build config json passed in', async () => {
  const name = 'test123-bootc-image-builder';
  const build = {
    image: 'test-image',
    tag: 'latest',
    type: ['raw'],
    arch: 'amd64',
    folder: '/foo/bar/qemutest4',
    buildConfigFilePath: '/foo/bar/baz/config.json',
  } as BootcBuildInfo;

  const options = createBuilderImageOptions(name, build);

  expect(options).toBeDefined();
  expect(options.HostConfig).toBeDefined();
  expect(options.HostConfig?.Binds).toBeDefined();
  if (options.HostConfig?.Binds) {
    expect(options.HostConfig.Binds.length).toEqual(3);
    expect(options.HostConfig.Binds[0]).toEqual(build.folder + ':/output/');
    expect(options.HostConfig.Binds[1]).toEqual('/var/lib/containers/storage:/var/lib/containers/storage');
    expect(options.HostConfig.Binds[2]).toEqual(build.buildConfigFilePath + ':/config.json:ro');
  }
});

test('test chown works when passed into createBuilderImageOptions', async () => {
  const name = 'test123-bootc-image-builder';
  const build = {
    image: 'test-image',
    tag: 'latest',
    type: ['raw'],
    arch: 'amd64',
    folder: '/foo/bar/qemutest4',
    chown: '1000:1000',
  } as BootcBuildInfo;

  const options = createBuilderImageOptions(name, build);

  expect(options).toBeDefined();
  expect(options.HostConfig).toBeDefined();
  expect(options.HostConfig?.Binds).toBeDefined();
  if (options.HostConfig?.Binds) {
    expect(options.HostConfig.Binds.length).toEqual(2);
    expect(options.HostConfig.Binds[0]).toEqual(build.folder + ':/output/');
    expect(options.HostConfig.Binds[1]).toEqual('/var/lib/containers/storage:/var/lib/containers/storage');
  }
  expect(options.Cmd).toContain('--chown');
  expect(options.Cmd).toContain(build.chown);
});

test('test createBuildConfigJSON function works when passing in a build config with user, filesystem and kernel', async () => {
  const buildConfig = {
    user: [
      {
        name: 'test-user',
        // eslint-disable-next-line sonarjs/no-hardcoded-passwords
        password: 'test-password',
        key: 'test-key',
        groups: ['test-group'],
      },
    ],
    filesystem: [
      {
        mountpoint: '/test/mountpoint',
        minsize: '1GB',
      },
    ],
    kernel: {
      append: 'test-append',
    },
  } as BuildConfig;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buildConfigJson: Record<string, any> = createBuildConfigJSON(buildConfig);
  expect(buildConfigJson).toBeDefined();

  // buildConfigJson is Record<string, unknown>, but check that the first one is 'customnizations'
  const keys = Object.keys(buildConfigJson);
  expect(keys[0]).toEqual('customizations');

  // Check that user, filesystem and kernel are included in the JSON
  expect(buildConfigJson.customizations).toBeDefined();
  expect(buildConfigJson?.customizations?.user[0]).toBeDefined();
  expect(buildConfigJson?.customizations?.filesystem[0]).toBeDefined();
  expect(buildConfigJson?.customizations?.kernel).toBeDefined();
});

test('test building with a buildConfig JSON file that a temporary file for buildconfig is passed to binds', async () => {
  const buildConfig = {
    user: [
      {
        name: 'test-user',
        // eslint-disable-next-line sonarjs/no-hardcoded-passwords
        password: 'test-password',
        key: 'test-key',
        groups: ['test-group'],
      },
    ],
    filesystem: [
      {
        mountpoint: '/test/mountpoint',
        minsize: '1GB',
      },
    ],
    kernel: {
      append: 'test-append',
    },
  } as BuildConfig;

  const name = 'test123-bootc-image-builder';
  const build = {
    image: 'test-image',
    tag: 'latest',
    type: ['raw'],
    arch: 'amd64',
    folder: '/foo/bar/qemutest4',
    buildConfig: buildConfig,
  } as BootcBuildInfo;

  const options = createBuilderImageOptions(name, build);

  // Expect writeFileSync was called
  expect(fs.writeFileSync).toHaveBeenCalled();

  // Expect that options.HostConfig.Binds includes a buildconfig file
  expect(options).toBeDefined();
  expect(options.HostConfig).toBeDefined();
  expect(options.HostConfig?.Binds).toBeDefined();
  if (options.HostConfig?.Binds) {
    expect(options.HostConfig.Binds.length).toEqual(3);
    expect(options.HostConfig.Binds[0]).toEqual(build.folder + ':/output/');
    expect(options.HostConfig.Binds[1]).toEqual('/var/lib/containers/storage:/var/lib/containers/storage');
    expect(options.HostConfig.Binds[2]).toContain('config.json:ro');
  }
});

test('expect createBuildConfigJSON to work with anaconda iso modules being enabled / disabled', async () => {
  const buildConfig = {
    anacondaIsoInstallerModules: {
      enable: ['test-module', 'test-module2'],
      disable: ['test-module3', 'test-module4'],
    },
  } as BuildConfig;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buildConfigJson: Record<string, any> = createBuildConfigJSON(buildConfig);
  expect(buildConfigJson).toBeDefined();

  // Expect enable to contain test-module and 2
  expect(buildConfigJson.customizations.installer.modules.enable).toContain('test-module');
  expect(buildConfigJson.customizations.installer.modules.enable).toContain('test-module2');

  // Expect disable to contain test-module3 and 4
  expect(buildConfigJson.customizations.installer.modules.disable).toContain('test-module3');
  expect(buildConfigJson.customizations.installer.modules.disable).toContain('test-module4');
});

test('expect createBuildConfigJSON to read a valid kickstart file and output it to the JSON file stringified', async () => {
  const buildConfig = {
    anacondaIsoInstallerKickstartFilePath: '/foo/bar/kickstart.ks',
  } as BuildConfig;

  const mockKickstartFileContents = `
  # Kickstart file for CentOS 7
  #platform=x86, AMD64, or Intel EM64T
  # System authorization information
  auth --enableshadow --passalgo=sha512
  # Use CDROM installation media
  cdrom
  # Use graphical install
  graphical
  # Run the Setup Agent on first boot
  firstboot --enable
  # Keyboard layouts
  keyboard --vckeymap=us --xlayouts='us'
  # System language
  lang en_US
  `;

  // Spy on fs.readFileSync to make sure it is called
  vi.mock('node:fs');
  vi.spyOn(fs, 'existsSync').mockReturnValue(true);
  vi.spyOn(fs, 'readFileSync').mockReturnValue(mockKickstartFileContents);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buildConfigJson: Record<string, any> = createBuildConfigJSON(buildConfig);
  expect(buildConfigJson).toBeDefined();

  // Expect readFileSync was called
  expect(fs.readFileSync).toHaveBeenCalled();

  // Expect the kickstart file to be in the JSON
  // we "slice" the Stringify contents to also remove the quotes
  expect(buildConfigJson.customizations.installer.kickstart.contents).toEqual(
    JSON.stringify(mockKickstartFileContents).slice(1, -1),
  );
});

test('expect build to kick off in background', async () => {
  const build = {
    id: 'new-image',
    image: 'test-image',
    tag: 'latest',
    type: ['raw'],
    arch: 'amd64',
    engineId: 'podman',
    folder: '/foo/bar/test',
  } as BootcBuildInfo;

  const history = {
    addOrUpdateBuildInfo: vi.fn(),
  } as unknown as History;

  vi.mocked(extensionApi.window.withProgress).mockResolvedValue(new Promise(res => setTimeout(res, 2_000)));
  vi.mocked(getContainerEngine).mockResolvedValue({
    connection: { type: 'podman', status: vi.fn().mockReturnValue('started') },
  } as unknown as extensionApi.ContainerProviderConnection);

  await buildDiskImage(build, history, true);

  // expect withProgress to still be running
  expect(extensionApi.window.withProgress).toHaveBeenCalled();
  expect(extensionApi.window.withProgress).not.toHaveResolved();
});
