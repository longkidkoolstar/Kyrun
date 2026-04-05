# Launches Kyrun (Electron) with the project folder as cwd. Intended to run elevated (UAC).
$ErrorActionPreference = 'Stop'
$Root = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
    [System.Windows.Forms.MessageBox]::Show(
        'Kyrun must run as Administrator. Use Launch-Kyrun-Admin.vbs or accept the UAC prompt when using the batch launcher.',
        'Kyrun',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Warning
    ) | Out-Null
    exit 1
}

Set-Location -LiteralPath $Root
$electronCmd = Join-Path $Root 'node_modules\.bin\electron.cmd'
if (-not (Test-Path -LiteralPath $electronCmd)) {
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
    [System.Windows.Forms.MessageBox]::Show(
        "Electron not found. Run npm install in:`n$Root",
        'Kyrun',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
    exit 1
}

# Same as npm start: electron .
& $electronCmd .
