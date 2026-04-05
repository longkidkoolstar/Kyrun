' Double-click this file: UAC prompt, then Kyrun starts as Administrator (no terminal window).
Option Explicit
Dim fso, root, ps1, shell
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = root & "\Launch-Kyrun-Admin.ps1"
If Not fso.FileExists(ps1) Then
    MsgBox "Missing Launch-Kyrun-Admin.ps1 next to this file.", vbCritical, "Kyrun"
    WScript.Quit 1
End If
Set shell = CreateObject("Shell.Application")
' runas = Request elevation; 0 = hidden window for the short-lived PowerShell host
shell.ShellExecute "powershell.exe", "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """", root, "runas", 0
