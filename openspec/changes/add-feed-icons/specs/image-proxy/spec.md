# Spec Delta

## ADDED Requirements

### Requirement: ICOの画像の受け付け

元のURLの応答の中身がICOの形式のとき、サーバーは、その画像を `Content-Type: image/x-icon` で返さなければならない（MUST）。
ICOの形式は、応答が称するContent-Typeではなく、中身の先頭のバイトで判別しなければならない（MUST）。

#### Scenario: サイトのfavicon.ico

- **WHEN** 元のURLが、先頭の4バイトが `00 00 01 00` のICOの画像を返す
- **THEN** サーバーはその画像を `Content-Type: image/x-icon` とHTTPステータス200で返す

#### Scenario: ICOと称するHTML

- **WHEN** 元のURLが、Content-Typeを `image/x-icon` と称するHTMLのページを返す
- **THEN** サーバーはHTTPステータス502を返し、HTMLの中身は返さない
