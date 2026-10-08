import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TranscriptionConfig } from './transcription-service'

let directory: string
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'credential-test-'))
})
afterEach(() => rmSync(directory, { recursive: true, force: true }))
const path = () => join(directory, 'transcription.json')
const secure = () => ({
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((value: string) => Buffer.from(`encrypted:${value}`)),
  decryptString: vi.fn((value: Buffer) => value.toString().replace(/^encrypted:/, ''))
})
describe('transcription configuration persistence', () => {
  it('defaults missing or corrupt config and preserves appearance when changing models', () => {
    const config = new TranscriptionConfig(directory)
    expect(config.getKey()).toBeNull()
    expect(config.persistenceAvailable()).toBe(false)
    expect(config.preferences()).toEqual({ theme: 'system', density: 'default' })
    expect(config.selectedModel()).toBe('ggml-small.bin')
    writeFileSync(path(), '{invalid')
    expect(config.preferences()).toEqual({ theme: 'system', density: 'default' })
    config.setPreferences({ theme: 'dark', density: 'compact' })
    config.setSelectedModel('ggml-tiny.bin')
    expect(new TranscriptionConfig(directory).preferences()).toEqual({ theme: 'dark', density: 'compact' })
    expect(config.selectedModel()).toBe('ggml-tiny.bin')
    config.setSelectedModel('unrecognized')
    expect(config.selectedModel()).toBe('ggml-small.bin')
  })
  it('encrypts keys before persisting and removes both old and encrypted keys', () => {
    const storage = secure()
    const config = new TranscriptionConfig(directory, storage)
    writeFileSync(path(), JSON.stringify({ openRouterKey: 'old plaintext', theme: 'dark' }))
    config.setKey(' test-key ')
    const saved = JSON.parse(readFileSync(path(), 'utf8'))
    expect(saved.openRouterKey).toBeUndefined()
    expect(saved.encryptedOpenRouterKey).toBe(Buffer.from('encrypted:test-key').toString('base64'))
    expect(config.getKey()).toBe('test-key')
    expect(new TranscriptionConfig(directory, storage).getKey()).toBe('test-key')
    config.removeKey()
    expect(config.getKey()).toBeNull()
    expect(JSON.parse(readFileSync(path(), 'utf8'))).toEqual({ theme: 'dark' })
  })
  it('keeps keys in the session when secure storage is unavailable', () => {
    const storage = secure()
    storage.isEncryptionAvailable.mockReturnValue(false)
    const config = new TranscriptionConfig(directory, storage)
    writeFileSync(path(), JSON.stringify({ openRouterKey: 'old', encryptedOpenRouterKey: 'stale', density: 'compact' }))
    config.setKey(' session-key ')
    expect(config.getKey()).toBe('session-key')
    expect(JSON.parse(readFileSync(path(), 'utf8'))).toEqual({ density: 'compact' })
    expect(new TranscriptionConfig(directory, storage).getKey()).toBeNull()
    expect(storage.encryptString).not.toHaveBeenCalled()
    config.removeKey()
    expect(config.getKey()).toBeNull()
  })
  it.each([true, false])('migrates legacy plaintext with encryption available=%s', (available) => {
    const storage = secure()
    storage.isEncryptionAvailable.mockReturnValue(available)
    writeFileSync(path(), JSON.stringify({ openRouterKey: 'legacy-key' }))
    const config = new TranscriptionConfig(directory, storage)
    expect(config.getKey()).toBe('legacy-key')
    if (available) expect(readFileSync(path(), 'utf8')).not.toContain('legacy-key')
    else expect(storage.encryptString).not.toHaveBeenCalled()
  })
  it('returns no key when decryption fails and preserves stored data if verification fails', () => {
    const storage = secure()
    const config = new TranscriptionConfig(directory, storage)
    writeFileSync(path(), JSON.stringify({ encryptedOpenRouterKey: 'dGVzdA==' }))
    storage.decryptString.mockImplementationOnce(() => {
      throw new Error('locked')
    })
    expect(config.getKey()).toBeNull()
    const previous = readFileSync(path(), 'utf8')
    storage.decryptString.mockReturnValueOnce('wrong key')
    expect(() => config.setKey('replacement')).toThrow('encryption did not verify')
    expect(readFileSync(path(), 'utf8')).toBe(previous)
    storage.isEncryptionAvailable.mockReturnValue(false)
    expect(config.getKey()).toBeNull()
  })
})
