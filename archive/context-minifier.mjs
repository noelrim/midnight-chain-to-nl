#!/usr/bin/env node
// context-minifier.mjs
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { createHash } from 'crypto';

class ContextMinifier {
  constructor() {
    // Key mappings for top-level table properties
    this.keyMap = {
      // Table properties
      'description': 'd',
      'grain': 'g',
      'size': 's',
      'primary_alias': 'pa',
      'aliases': 'a',
      'semantic_tags': 'st',
      'soft_join_keys': 'jk',
      'query_hints': 'qh',
      'notes': 'n',
      
      // Database properties
      'database': 'db',
      
      // Template references (will be inlined)
      '_templates': '_t',
      '_alias_groups': '_ag'
    };
    
    // Size mappings
    this.sizeMap = {
      'xs': '1',  // ~10-100 rows
      's': '2',   // ~100-1K rows  
      'm': '3',   // ~1K-10K rows
      'l': '4',   // ~10K-100K rows
      'xl': '5',  // ~100K-1M rows
      'xxl': '6'  // 1M+ rows
    };
    
    // Common semantic tag abbreviations
    this.tagMap = {
      'blockchain': 'bc',
      'midnight': 'mn',
      'validator': 'val',
      'consensus': 'con',
      'staking': 'stk',
      'distributed_ledger': 'dl',
      'time_series': 'ts',
      'temporal': 'tmp',
      'metrics': 'mtr',
      'aggregated_data': 'agg',
      'detailed_data': 'det',
      'master_data': 'mst',
      'configuration': 'cfg',
      'smart_contracts': 'sc',
      'transactions': 'tx',
      'blocks': 'blk',
      'identity': 'id',
      'mapping': 'map',
      'lookup': 'lkp',
      'singleton': 'sng',
      'metadata': 'md',
      'economics': 'eco',
      'performance': 'prf',
      'uptime': 'up',
      'dapps': 'da',
      'calendar': 'cal',
      'time_dimension': 'td',
      'descriptive_data': 'dsc',
      'registration': 'reg',
      'ledger': 'ldg',
      'chain_parameters': 'cp'
    };
    
    // Store for reusable strings
    this.stringCache = new Map();
    this.stringCounter = 0;
    
    // Store for alias groups (to be flattened)
    this.aliasGroups = {};
    
    // Store for templates (to be inlined)
    this.templates = {};
    
    // Track which abbreviations were actually used
    this.usedAbbreviations = new Set();
    
    // Store original alias arrays for each table
    this.tableAliasGroups = {};
  }
  
  /**
   * Generate a short hash for repeated long strings
   */
  getStringRef(str) {
    if (str.length < 20) return str; // Don't compress short strings
    
    if (!this.stringCache.has(str)) {
      const ref = `$${this.stringCounter++}`;
      this.stringCache.set(str, ref);
    }
    return this.stringCache.get(str);
  }
  
  /**
   * Compress semantic tags
   */
  compressTags(tags) {
    if (!tags) return null;
    return tags.map(tag => {
      const abbr = this.tagMap[tag];
      if (abbr) {
        this.usedAbbreviations.add(abbr);
        return abbr;
      }
      return tag;
    });
  }
  
  /**
   * Compress aliases - convert array to string if single element
   * Also track which table uses which alias group
   */
  compressAliases(aliases, tableName) {
    if (!aliases) return null;
    
    // If it's a reference to alias group
    if (typeof aliases === 'string' && aliases.startsWith('*')) {
      const groupName = aliases.substring(1);
      if (this.aliasGroups[groupName]) {
        aliases = this.aliasGroups[groupName];
        // Track that this table uses this alias group
        if (tableName) {
          this.tableAliasGroups[tableName] = groupName;
        }
      }
    }
    
    // Flatten arrays if referenced from groups
    if (Array.isArray(aliases)) {
      // Join with pipe for compactness
      return aliases.join('|');
    }
    
    return aliases;
  }
  
  /**
   * Compress query hints into abbreviated format
   */
  compressQueryHints(hints) {
    if (!hints || !Array.isArray(hints)) return null;
    
    // Join hints with semicolon for more compact representation
    // Also abbreviate common patterns
    return hints.map(hint => {
      return hint
        .replace(/Join with /g, 'jw:')
        .replace(/Use for /g, 'uf:')
        .replace(/Contains /g, 'has:')
        .replace(/DO NOT /g, '!!')
        .replace(/ table/g, ' t')
        .replace(/validator/g, 'val')
        .replace(/transaction/g, 'tx')
        .replace(/epoch_schedule/g, 'es')
        .replace(/aura_pub_key/g, 'apk');
    }).join(';');
  }
  
  /**
   * Process templates and inline them
   */
  processTemplates(data) {
    // Extract templates
    if (data._templates) {
      for (const [key, template] of Object.entries(data._templates)) {
        // Remove the anchor notation
        const cleanKey = key ? key.replace(/^&/, '') : key;
        if (template) {
          this.templates[cleanKey] = this.minifyTableEntry(template, null);
        }
      }
    }
    
    // Extract alias groups
    if (data._alias_groups) {
      for (const [key, group] of Object.entries(data._alias_groups)) {
        const cleanKey = key ? key.replace(/^&/, '') : key;
        this.aliasGroups[cleanKey] = group;
      }
    }
  }
  
  /**
   * Inline template references
   */
  inlineTemplates(entry) {
    if (!entry || typeof entry !== 'object') return entry;
    
    const result = {};
    
    for (const [key, value] of Object.entries(entry)) {
      // Skip merge keys that reference templates
      if (key === '<<') continue;
      
      // Check if this entry uses templates
      if (entry['<<']) {
        const templates = Array.isArray(entry['<<']) ? entry['<<'] : [entry['<<']];
        
        // Merge templates first
        for (const tmplRef of templates) {
          if (typeof tmplRef === 'string' && tmplRef.startsWith('*')) {
            const tmplName = tmplRef.substring(1).replace('_template', '');
            if (this.templates[tmplName]) {
              Object.assign(result, this.templates[tmplName]);
            }
          }
        }
      }
      
      // Override with actual values
      result[key] = value;
    }
    
    return Object.keys(result).length > 0 ? result : entry;
  }
  
  /**
   * Minify a single table entry
   */
  minifyTableEntry(entry, tableName) {
    if (!entry || typeof entry !== 'object') return null;
    
    const minified = {};
    
    // Inline templates first
    const processed = this.inlineTemplates(entry);
    
    for (const [key, value] of Object.entries(processed)) {
      const newKey = this.keyMap[key] || key;
      
      if (key === 'size' && value && this.sizeMap[value]) {
        minified[newKey] = this.sizeMap[value];
      } else if (key === 'semantic_tags') {
        const compressed = this.compressTags(value);
        if (compressed) minified[newKey] = compressed;
      } else if (key === 'aliases') {
        const compressed = this.compressAliases(value, tableName);
        if (compressed) minified[newKey] = compressed;
      } else if (key === 'query_hints') {
        const compressed = this.compressQueryHints(value);
        if (compressed) minified[newKey] = compressed;
      } else if (key === 'grain' && value) {
        // Simplify grain format
        minified[newKey] = value.replace('1 row / ', '').replace('1 row', '1');
      } else if (key === 'soft_join_keys' && Array.isArray(value)) {
        // Join keys with comma
        minified[newKey] = value.join(',');
      } else if (key === 'soft_join_keys' && value === null) {
        // Skip null soft_join_keys
        continue;
      } else if (value !== null && value !== undefined) {
        minified[newKey] = value;
      }
    }
    
    return minified;
  }
  
  /**
   * Create the minified context
   */
  minify(yamlContent) {
    const data = yaml.load(yamlContent);
    
    // Process templates and alias groups first (if they exist)
    this.processTemplates(data);
    
    const minified = {
      _k: this.generateKeyLegend(),
      db: data.database || 'unknown',
      d: data.description || ''
    };
    
    // Process tables
    const tables = {};
    for (const [tableName, tableData] of Object.entries(data)) {
      // Skip meta entries and null/undefined entries
      if (tableName.startsWith('_') || 
          tableName === 'database' || 
          tableName === 'description' ||
          !tableData ||
          typeof tableData !== 'object') {
        continue;
      }
      
      // Shorten table names
      const shortName = tableName.replace('public.', '');
      const minifiedEntry = this.minifyTableEntry(tableData, shortName);
      if (minifiedEntry) {
        tables[shortName] = minifiedEntry;
      }
    }
    
    minified.t = tables;
    
    // Add table-to-alias-group mapping if any alias groups were used
    if (Object.keys(this.tableAliasGroups).length > 0) {
      minified._tag = this.tableAliasGroups;
    }
    
    // Add string cache if used
    if (this.stringCache.size > 0) {
      minified._s = Object.fromEntries(
        Array.from(this.stringCache.entries()).map(([str, ref]) => [ref, str])
      );
    }
    
    return minified;
  }
  
  /**
   * Generate a comprehensive legend for the LLM
   */
  generateKeyLegend() {
    const legend = {
      _desc: 'Key mappings for minified context',
      keys: {
        d: 'description',
        g: 'grain',
        s: 'size(1=xs,2=s,3=m,4=l,5=xl,6=xxl)',
        pa: 'primary_alias',
        a: 'aliases(pipe-separated)',
        st: 'semantic_tags',
        jk: 'join_keys(comma-separated)',
        qh: 'query_hints(semicolon-separated)',
        n: 'notes'
      }
    };
    
    // Add semantic tag mappings if any were used
    const usedTags = new Set();
    for (const [full, abbr] of Object.entries(this.tagMap)) {
      if (this.usedAbbreviations.has(abbr)) {
        usedTags.add(`${abbr}=${full}`);
      }
    }
    if (usedTags.size > 0) {
      legend.tags = Array.from(usedTags).join(',');
    }
    
    // Add alias group descriptions if any were used
    if (Object.keys(this.aliasGroups).length > 0) {
      legend.alias_groups = {};
      for (const [key, values] of Object.entries(this.aliasGroups)) {
        // Create a short description of what this alias group represents
        const groupDesc = this.getAliasGroupDescription(key, values);
        if (groupDesc) {
          legend.alias_groups[key] = groupDesc;
        }
      }
    }
    
    // Add query hint abbreviations
    legend.hint_abbr = {
      'jw:': 'Join with',
      'uf:': 'Use for',
      'has:': 'Contains',
      '!!': 'DO NOT',
      't': 'table',
      'val': 'validator',
      'tx': 'transaction',
      'es': 'epoch_schedule',
      'apk': 'aura_pub_key'
    };
    
    return legend;
  }
  
  /**
   * Generate a description for an alias group based on its content
   */
  getAliasGroupDescription(groupKey, values) {
    // Map group keys to their semantic meaning
    const groupDescriptions = {
      'validator_aliases': 'validator/SPO/block producer terms',
      'block_aliases': 'block/ledger block terms',
      'transaction_aliases': 'transaction/tx/ledger terms',
      'contract_aliases': 'smart contract/dapp terms',
      'epoch_aliases': 'epoch/time period terms',
      'config_aliases': 'configuration/settings terms'
    };
    
    return groupDescriptions[groupKey] || `${groupKey} terms`;
  }
  
  /**
   * Generate a compact text format with inline legend (LLM-optimized)
   */
  toCompactText(minified) {
    let text = `# Database Context (Minified)\n`;
    text += `DB: ${minified.db}\n`;
    text += `Description: ${minified.d}\n\n`;
    
    // Inline legend for easy reference
    text += `## Legend\n`;
    text += `Keys: d=description, g=grain, s=size(1-6:xs-xxl), pa=primary_alias, `;
    text += `a=aliases, st=semantic_tags, jk=join_keys, qh=query_hints, n=notes\n`;
    
    // Add semantic tag mappings if present
    if (minified._k.tags) {
      text += `Tags: ${minified._k.tags}\n`;
    }
    
    // Add hint abbreviations
    if (minified._k.hint_abbr) {
      const hints = Object.entries(minified._k.hint_abbr)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      text += `Hints: ${hints}\n`;
    }
    
    text += `\n## Tables\n`;
    
    for (const [table, data] of Object.entries(minified.t)) {
      text += `\n### ${table}\n`;
      for (const [key, value] of Object.entries(data)) {
        if (Array.isArray(value)) {
          text += `${key}: [${value.join(',')}]\n`;
        } else if (typeof value === 'object') {
          text += `${key}: ${JSON.stringify(value)}\n`;
        } else {
          text += `${key}: ${value}\n`;
        }
      }
    }
    
    // Add alias group descriptions if present
    if (minified._k.alias_groups && Object.keys(minified._k.alias_groups).length > 0) {
      text += `\n## Alias Groups\n`;
      for (const [group, desc] of Object.entries(minified._k.alias_groups)) {
        text += `${group}: ${desc}\n`;
      }
    }
    
    // Add table-to-alias-group mapping if present
    if (minified._tag) {
      text += `\n## Table Alias Group Usage\n`;
      for (const [table, group] of Object.entries(minified._tag)) {
        text += `${table} uses ${group}\n`;
      }
    }
    
    return text;
  }
  
  /**
   * Generate an LLM instruction format (alternative output)
   */
  /**
   * Generate an LLM instruction format (alternative output)
   */
  toLLMFormat(minified) {
    let text = `You have access to the following database:\n\n`;
    text += `Database: "${minified.db}" - ${minified.d}\n\n`;
    text += `When generating SQL, use these abbreviated table contexts:\n\n`;

    const hintMap =
      (minified._k && minified._k.hint_abbr) ? minified._k.hint_abbr : {};

    for (const [tableName, data] of Object.entries(minified.t)) {
      text += `Table: ${tableName}\n`;
      if (data.d)  text += `  Purpose: ${data.d}\n`;
      if (data.pa) text += `  Use alias: ${data.pa}\n`;
      if (data.a)  text += `  Matches queries about: ${data.a}\n`;
      if (data.g)  text += `  Granularity: ${data.g}\n`;
      if (data.jk) text += `  Can join on: ${data.jk}\n`;
      if (data.qh) {
        let hints = data.qh;
        for (const [abbr, full] of Object.entries(hintMap)) {
          // Node 18+ has replaceAll; if older, switch to split/join.
          hints = hints.replaceAll(abbr, full);
        }
        text += `  Important: ${hints}\n`;
      }
      text += `\n`;
    }

    return text;
  }
} // <-- closes class ContextMinifier

// CLI Interface
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log('Usage: node context-minifier.mjs <input.yml> [output]');
    console.log('Options:');
    console.log('  --format=json   Output as minified JSON (default)');
    console.log('  --format=text   Output as compact text format');
    console.log('  --format=llm    Output as LLM-optimized format (most readable)');
    console.log('  --stats         Show compression statistics');
    process.exit(1);
  }

  const inputFile = args[0];
  const outputFile = args[1] || inputFile.replace(/\.ya?ml$/i, '.min.json');
  const format = (args.find(a => a.startsWith('--format='))?.split('=')[1]) || 'json';
  const showStats = args.includes('--stats');

  try {
    const yamlContent = fs.readFileSync(inputFile, 'utf8');
    const originalSize = Buffer.byteLength(yamlContent, 'utf8');

    const minifier = new ContextMinifier();
    const minified = minifier.minify(yamlContent);

    let output;
    if (format === 'text') {
      output = minifier.toCompactText(minified);
    } else if (format === 'llm') {
      output = minifier.toLLMFormat(minified);
    } else {
      output = JSON.stringify(minified, null, 2);
    }

    fs.writeFileSync(outputFile, output);
    const minifiedSize = Buffer.byteLength(output, 'utf8');

    if (showStats) {
      console.log('\n📊 Compression Statistics:');
      console.log(`Original size: ${originalSize} bytes`);
      console.log(`Output size:   ${minifiedSize} bytes`);
      console.log(`Compression:   ${((1 - minifiedSize / originalSize) * 100).toFixed(1)}%`);
      console.log(`Tables:        ${Object.keys(minified.t).length}`);
      console.log(`Format:        ${format}`);
      console.log(`Output file:   ${outputFile}`);
    } else {
      console.log(`✅ Minified context saved to ${outputFile}`);
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

// Export for use as module
export { ContextMinifier };
