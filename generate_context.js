#!/usr/bin/env node

import fs from 'fs';
import * as fsp from 'fs/promises';
import path from 'path';
import ignore from 'ignore';

// --- CONFIGURATION ---
const OUTPUT_FILE = 'llm_context.txt';
const MAX_FILE_SIZE_MB = 2; // Skip files larger than this

// Hard safety nets (always skipped to prevent infinite loops or massive bloat)
const ALWAYS_SKIP_DIRS = new Set(['.git', '.svn', '.hg']);
const ALWAYS_SKIP_FILES = new Set([OUTPUT_FILE, 'generate_context.js', 'package-lock.json']);

/**
 * Loads .contextignore, falling back to .gitignore.
 */
function loadIgnoreSpec(rootDir) {
    const contextIgnorePath = path.join(rootDir, '.contextignore');
    const gitIgnorePath = path.join(rootDir, '.gitignore');
    
    let ignoreFile = null;
    if (fs.existsSync(contextIgnorePath)) {
        ignoreFile = contextIgnorePath;
    } else if (fs.existsSync(gitIgnorePath)) {
        ignoreFile = gitIgnorePath;
        console.log('ℹ️  No .contextignore found. Falling back to .gitignore');
    }

    const ig = ignore();
    
    if (ignoreFile) {
        console.log(`📋 Using ignore file: ${path.basename(ignoreFile)}`);
        const patterns = fs.readFileSync(ignoreFile, 'utf-8').split(/\r?\n/);
        ig.add(patterns);
    } else {
        console.log('ℹ️  No .contextignore or .gitignore found. Including all files.');
    }

    return ig;
}

/**
 * Checks if a file is binary by looking for null bytes in the first 8KB.
 */
async function isBinary(filePath) {
    try {
        const fd = await fsp.open(filePath, 'r');
        const buffer = Buffer.alloc(8192);
        const { bytesRead } = await fd.read(buffer, 0, 8192, 0);
        await fd.close();
        
        for (let i = 0; i < bytesRead; i++) {
            if (buffer[i] === 0) return true;
        }
        return false;
    } catch (err) {
        return true; // If we can't read it, treat as binary/skip
    }
}

async function main() {
    const rootDir = process.cwd();
    const outputPath = path.join(rootDir, OUTPUT_FILE);
    
    console.log(`📂 Repository root: ${rootDir}`);
    const ig = loadIgnoreSpec(rootDir);

    console.log('🔍 Scanning files...');
    
    // Use a queue for Breadth-First Search (avoids call stack limits on deep trees)
    const queue = [rootDir];
    const filesToProcess = [];
    let skippedCount = 0;

    while (queue.length > 0) {
        const currentDir = queue.shift();
        let entries;
        
        try {
            entries = await fsp.readdir(currentDir, { withFileTypes: true });
        } catch (err) {
            continue; // Skip directories we can't read
        }

        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            
            // Normalize path for the 'ignore' package (must use forward slashes)
            const relPath = path.relative(rootDir, fullPath).split(path.sep).join('/');

            if (entry.isDirectory()) {
                // 1. Check hard skips
                if (ALWAYS_SKIP_DIRS.has(entry.name)) continue;

                // 2. Check ignore spec (add trailing slash to match directory-only patterns)
                if (ig.ignores(relPath + '/')) continue;

                // 3. Add to queue to traverse
                queue.push(fullPath);
                
            } else if (entry.isFile() || entry.isSymbolicLink()) {
                // 1. Check hard skips
                if (ALWAYS_SKIP_FILES.has(entry.name)) continue;

                // 2. Check ignore spec
                if (ig.ignores(relPath)) {
                    skippedCount++;
                    continue;
                }

                // 3. Check file size and ensure it's actually a file (not a broken symlink)
                try {
                    const stat = await fsp.stat(fullPath);
                    if (!stat.isFile()) continue;
                    if (stat.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
                        skippedCount++;
                        continue;
                    }
                } catch (err) {
                    continue;
                }

                filesToProcess.push(fullPath);
            }
        }
    }

    // Sort files alphabetically for consistent output
    filesToProcess.sort();
    console.log(`📄 Writing ${filesToProcess.length} files to ${OUTPUT_FILE}...\n`);

    // Use a write stream to keep memory usage near zero
    const stream = fs.createWriteStream(outputPath, 'utf-8');
    
    // Write LLM Header
    stream.write(
        "The following is the complete source code of a project.\n" +
        "Each file is delimited by <file> tags with a 'path' attribute " +
        "showing its location relative to the project root.\n" +
        "Use these paths when referencing, editing, or creating files.\n\n"
    );

    let processedCount = 0;
    let errorCount = 0;

    for (const filePath of filesToProcess) {
        const relPath = path.relative(rootDir, filePath).split(path.sep).join('/');

        // Skip binaries
        if (await isBinary(filePath)) {
            skippedCount++;
            continue;
        }

        try {
            const content = await fsp.readFile(filePath, 'utf-8');
            
            stream.write(`<file path="${relPath}">\n`);
            stream.write(content);
            if (content.length > 0 && !content.endsWith('\n')) {
                stream.write('\n');
            }
            stream.write('</file>\n\n');
            
            processedCount++;
        } catch (err) {
            errorCount++;
        }
    }

    // Wait for the stream to finish writing to disk
    await new Promise((resolve) => stream.end(resolve));

    const stats = await fsp.stat(outputPath);
    const sizeKB = (stats.size / 1024).toFixed(1);

    console.log('-'.repeat(50));
    console.log('✅ Done!');
    console.log(`   Files included : ${processedCount}`);
    console.log(`   Files skipped  : ${skippedCount}`);
    console.log(`   Files errored  : ${errorCount}`);
    console.log(`   Output size    : ${sizeKB} KB`);
    console.log(`   Saved to       : ${outputPath}`);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});