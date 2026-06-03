export type CompileToolbarVariant = 'current-overleaf' | 'legacy-angular-ce'

export type CompileToolbarTarget = {
  variant: CompileToolbarVariant
  group: HTMLElement
  compileButton: HTMLElement
}

const TOOLBAR_VARIANTS: Array<{
  variant: CompileToolbarVariant
  groupSelector: string
  compileButtonSelector: string
}> = [
  {
    variant: 'current-overleaf',
    groupSelector: '.compile-button-group',
    compileButtonSelector: '.compile-button',
  },
  {
    variant: 'legacy-angular-ce',
    groupSelector: '#recompile.btn-recompile-group',
    compileButtonSelector: '.btn-recompile:not(.dropdown-toggle)[ng-click="recompile()"]',
  },
]

export function findCompileToolbarTarget(root: ParentNode): CompileToolbarTarget | undefined {
  for (const variant of TOOLBAR_VARIANTS) {
    const group = root.querySelector<HTMLElement>(variant.groupSelector)
    const compileButton = group?.querySelector<HTMLElement>(variant.compileButtonSelector)
    if (group && compileButton) {
      return {
        variant: variant.variant,
        group,
        compileButton,
      }
    }
  }
  return undefined
}
