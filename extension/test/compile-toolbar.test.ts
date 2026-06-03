import { describe, expect, it } from 'vitest'
import { findCompileToolbarTarget } from '../src/compile-toolbar'

describe('findCompileToolbarTarget', () => {
  it('finds the current Overleaf compile toolbar', () => {
    document.body.innerHTML = `
      <div class="compile-button-group">
        <button class="compile-button">Recompile</button>
      </div>
    `

    const target = findCompileToolbarTarget(document)

    expect(target?.variant).toBe('current-overleaf')
    expect(target?.group.className).toBe('compile-button-group')
    expect(target?.compileButton.textContent).toBe('Recompile')
  })

  it('finds the legacy Angular CE recompile toolbar without relying on localized text', () => {
    document.body.innerHTML = `
      <div class="toolbar toolbar-pdf">
        <div class="btn-group btn-recompile-group" id="recompile" dropdown="">
          <a class="btn btn-recompile" href="" ng-disabled="pdf.compiling" ng-click="recompile()">
            <i class="fa fa-refresh"></i>
            <span class="btn-recompile-label">Recompiler</span>
          </a>
          <a class="btn btn-recompile dropdown-toggle" href="" dropdown-toggle="">
            <span class="caret"></span>
          </a>
        </div>
      </div>
    `

    const target = findCompileToolbarTarget(document)

    expect(target?.variant).toBe('legacy-angular-ce')
    expect(target?.group.id).toBe('recompile')
    expect(target?.compileButton.getAttribute('ng-click')).toBe('recompile()')
    expect(target?.compileButton.classList.contains('dropdown-toggle')).toBe(false)
  })

  it('does not match the legacy Angular dropdown toggle as the compile button', () => {
    document.body.innerHTML = `
      <div class="btn-group btn-recompile-group" id="recompile">
        <a class="btn btn-recompile dropdown-toggle" href="" dropdown-toggle="">
          <span class="caret"></span>
        </a>
      </div>
    `

    expect(findCompileToolbarTarget(document)).toBeUndefined()
  })
})
