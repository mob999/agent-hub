import type { CSSProperties } from 'react'

interface ProjectIconSource {
  id: string
  title: string
}

const projectIconPalette = [
  { backgroundColor: '#e8f1ff', borderColor: '#bdd7ff', color: '#1d4f91' },
  { backgroundColor: '#eaf7ef', borderColor: '#bde7ca', color: '#17613a' },
  { backgroundColor: '#fff4d8', borderColor: '#f5d78a', color: '#7a4b00' },
  { backgroundColor: '#f2ecff', borderColor: '#d7c8ff', color: '#5b3aa4' },
  { backgroundColor: '#ffeef2', borderColor: '#ffc8d3', color: '#9b2444' },
  { backgroundColor: '#e8fbfb', borderColor: '#b8e4e4', color: '#126164' },
  { backgroundColor: '#f4f0ea', borderColor: '#ded2c1', color: '#604525' },
  { backgroundColor: '#edf1f7', borderColor: '#cbd5e1', color: '#344054' },
]

function hashProjectSeed(seed: string): number {
  let hash = 0

  for (const character of seed) {
    hash = (hash * 31 + character.codePointAt(0)!) >>> 0
  }

  return hash
}

export function getProjectInitial(title: string): string {
  return Array.from(title.trim())[0]?.toLocaleUpperCase() ?? 'P'
}

export function getProjectIcon(project: ProjectIconSource): {
  initial: string
  style: CSSProperties
} {
  const seed = `${project.id}:${project.title}`
  const palette = projectIconPalette[hashProjectSeed(seed) % projectIconPalette.length]

  return {
    initial: getProjectInitial(project.title),
    style: palette,
  }
}
