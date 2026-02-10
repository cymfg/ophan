import { promises as fs } from 'fs';
import path from 'path';
import { parse as parseYaml } from 'yaml';

/**
 * Parsed goal definition from a .ophan/goals/*.md file.
 */
export interface ParsedGoalFile {
  id: string;
  title: string;
  priority: number;
  tags: string[];
  dependsOn: string[];
  description: string;
  acceptanceCriteria: string[];
  filePath: string;
}

/**
 * Parse a goal markdown file with YAML frontmatter.
 *
 * Expected format:
 * ```
 * ---
 * id: goal-my-feature
 * title: My Feature
 * priority: 5
 * tags: [feature]
 * dependsOn: []
 * ---
 *
 * ## Description
 * ...
 *
 * ## Acceptance Criteria
 * - [ ] Criterion 1
 * - [ ] Criterion 2
 * ```
 */
export function parseGoalFile(content: string, filePath: string): ParsedGoalFile {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!frontmatterMatch) {
    throw new Error(`Invalid goal file format (missing frontmatter): ${filePath}`);
  }

  const frontmatter = parseYaml(frontmatterMatch[1]) as Record<string, unknown>;
  const body = frontmatterMatch[2];

  // Extract required fields
  const id = (frontmatter.id as string) ?? path.basename(filePath, '.md');
  const title = (frontmatter.title as string) ?? id;
  const priority = (frontmatter.priority as number) ?? 10;
  const tags = (frontmatter.tags as string[]) ?? [];
  const dependsOn = (frontmatter.dependsOn as string[]) ?? [];

  // Parse description section
  const description = extractSection(body, 'Description');

  // Parse acceptance criteria (lines starting with - [ ] or - [x] or just -)
  const criteriaSection = extractSection(body, 'Acceptance Criteria');
  const acceptanceCriteria = criteriaSection
    .split('\n')
    .map((line) => line.replace(/^-\s*\[[ x]\]\s*/, '').replace(/^-\s*/, '').trim())
    .filter((line) => line.length > 0);

  return {
    id,
    title,
    priority,
    tags,
    dependsOn,
    description: description.trim(),
    acceptanceCriteria,
    filePath,
  };
}

/**
 * Load all goal files from .ophan/goals/ directory.
 */
export async function loadGoalFiles(goalsDir: string): Promise<ParsedGoalFile[]> {
  try {
    await fs.mkdir(goalsDir, { recursive: true });
    const files = await fs.readdir(goalsDir);
    const mdFiles = files.filter((f) => f.endsWith('.md'));

    const goals: ParsedGoalFile[] = [];

    for (const file of mdFiles) {
      const filePath = path.join(goalsDir, file);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        goals.push(parseGoalFile(content, filePath));
      } catch (error) {
        // Skip invalid goal files but log the error
        console.error(`Warning: Failed to parse goal file ${file}: ${(error as Error).message}`);
      }
    }

    return goals;
  } catch {
    return [];
  }
}

/**
 * Serialize a goal to markdown format for writing to a file.
 */
export function serializeGoalFile(goal: ParsedGoalFile): string {
  const frontmatter = [
    '---',
    `id: ${goal.id}`,
    `title: ${goal.title}`,
    `priority: ${goal.priority}`,
    `tags: [${goal.tags.join(', ')}]`,
    goal.dependsOn.length > 0 ? `dependsOn: [${goal.dependsOn.join(', ')}]` : 'dependsOn: []',
    '---',
  ].join('\n');

  const body = [
    '',
    '## Description',
    '',
    goal.description || 'TODO: Add description',
    '',
    '## Acceptance Criteria',
    '',
    ...goal.acceptanceCriteria.map((c) => `- [ ] ${c}`),
  ].join('\n');

  return frontmatter + '\n' + body + '\n';
}

/**
 * Generate a goal ID from a title.
 */
export function generateGoalId(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 40);
  return `goal-${slug}`;
}

/**
 * Extract a markdown section by heading name.
 */
function extractSection(body: string, heading: string): string {
  const regex = new RegExp(`##\\s+${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'i');
  const match = body.match(regex);
  return match ? match[1].trim() : '';
}
