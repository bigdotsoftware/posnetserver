$password = ConvertTo-SecureString "TUTAJ_16_ZNAKOW_HASLA_APLIKACJI" -AsPlainText -Force

$credential = New-Object System.Management.Automation.PSCredential(
    "user1@mydomain.pl",
    $password
)

Send-MailMessage `
    -SmtpServer "smtp.gmail.com" `
    -Port 587 `
    -UseSsl `
    -Credential $credential `
    -From "user1@mydomain.pl" `
    -To "user2@mydomain.pl" `
    -Subject "Test SMTP" `
    -Body "Test wysylki SMTP"
