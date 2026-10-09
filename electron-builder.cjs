// electron-builder loads this CommonJS configuration directly.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { version } = require('./package.json')

// Preserve the legacy nightly package identity. Production must also coexist
// with nightly versions installed before channel-specific packaging existed.
const nightly = version.includes('-nightly.')
const name = nightly ? 'research-notebook' : 'research-notebook-production'
const productName = nightly ? 'Research Notebook Nightly' : 'Research Notebook Production'

module.exports = {
  extends: './electron-builder.yml',
  appId: nightly ? 'com.researchnotebook.app' : 'com.researchnotebook.app.production',
  productName,
  executableName: name,
  extraMetadata: { name, desktopName: name, productName },
  artifactName: nightly
    ? 'Research-Notebook-${version}-${os}-${arch}.${ext}'
    : 'Research-Notebook-Production-${version}-${os}-${arch}.${ext}',
  linux: { syncDesktopName: true },
  deb: { packageName: name },
  rpm: { packageName: name },
  nsis: {
    artifactName: nightly
      ? 'Research-Notebook-${version}-Setup-${arch}.${ext}'
      : 'Research-Notebook-Production-${version}-Setup-${arch}.${ext}'
  },
  portable: {
    artifactName: nightly
      ? 'Research-Notebook-${version}-Portable-${arch}.${ext}'
      : 'Research-Notebook-Production-${version}-Portable-${arch}.${ext}'
  }
}
