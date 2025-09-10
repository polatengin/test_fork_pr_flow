// @ts-check

import path from 'path'
import fs from 'fs'

/** @param {import('@actions/github-script').AsyncFunctionArguments} AsyncFunctionArguments */
export default async ({ context, core }) => {
  try {
    const changes = core.getInput('CHANGES')
    const srcCore = core.getInput('SRC_CORE')

    if (!changes || typeof changes !== 'string' || changes.trim() === '') {
      core.setOutput('changes', JSON.stringify([]))
      return
    }

    if (!context?.eventName) {
      throw new Error('GitHub context is missing or invalid')
    }

    // Determine if we're using directories or files paths
    const useDirs = context.eventName === 'workflow_dispatch' && context.payload.inputs?.tf_dirs !== '*'

    // Split changes by comma and clean up each item
    const items = changes
      .split(',')
      .map((item) => item.trim().replace(/^["']|["']$/g, '')) // clean
      .filter((item) => item.length > 0)

    if (items.length === 0) {
      core.warning('No valid items found after parsing changes input')
      core.setOutput('changes', JSON.stringify([]))
      return
    }

    // Extract directory paths based on input type
    const dirPaths = new Set()

    // Check if any changes are in modules/**/*
    const hasModuleChanges = items.some((item) => {
      const itemPath = useDirs ? item : path.dirname(item)
      return itemPath.startsWith('modules/') || itemPath.startsWith('./modules/')
    })

    // If module changes detected, add all first-level configurations directories
    if (hasModuleChanges) {
      try {
        const refArchPath = path.resolve(srcCore)
        if (fs.existsSync(refArchPath)) {
          const refArchDirs = fs
            .readdirSync(refArchPath, { withFileTypes: true })
            .filter((dirent) => dirent.isDirectory())
            .map((dirent) => `${srcCore}/${dirent.name}`)

          refArchDirs.forEach((dir) => dirPaths.add(dir))
        }
      } catch (error) {
        throw new Error(`Error processing ${srcCore}: ${error.message}`)
      }
    }

    items.forEach((item) => {
      try {
        let dirPath = useDirs ? item : path.dirname(item)

        // normalize — if somehow a .tf file sneaks through, take its dirname
        if (dirPath.endsWith('.tf')) {
          dirPath = path.dirname(dirPath)
        }

        // cut off at /tests
        if (!useDirs && dirPath.includes('/tests')) {
          dirPath = dirPath.substring(0, dirPath.indexOf('/tests'))
        }

        const absPath = path.resolve(dirPath)
        if (!fs.existsSync(absPath) || !fs.statSync(absPath).isDirectory()) {
          core.warning(`Skipping non-directory path: ${dirPath}`)
          return
        }

        if (dirPath && dirPath !== '.' && !dirPath.includes('modules')) {
          dirPaths.add(dirPath)
        }
      } catch (error) {
        core.warning(`Failed to process item "${item}": ${error.message}`)
      }
    })

    // Convert Set to Array and sort
    const sortedDirPaths = Array.from(dirPaths).sort()

    // Build JSON array with path and basename
    const jsonOutput = sortedDirPaths.map((dirPath) => ({
      path: dirPath,
      name: path.basename(dirPath)
    }))

    const compactJson = JSON.stringify(jsonOutput)
    core.setOutput('changes', compactJson)
  } catch (error) {
    core.setFailed(error.message)
  }
}
