// 必要なモジュールをインポート
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import OpenAI from 'openai';
import fs from 'fs';
import pdfParse from 'pdf-parse';
import dotenv from 'dotenv';

// 環境変数の読み込み
dotenv.config();

// Expressアプリの初期化
const app = express();
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// CORSを有効にする
app.use(cors());

// Multerを使ってファイルアップロードを設定
const upload = multer({ dest: 'uploads/' });

// PDFの内容をテキストに変換する関数
async function extractTextFromPDF(filePath) {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    return data.text;
}

// OpenAI APIを使ってPDF内容を分析する関数
async function analyzePDF(pdfContent) {
    const prompt = `
#あなたの役割
・あなたは公認会計士です。
・新リース会計基準に則ってユーザが提供する契約書にリースが含まれるかどうかの識別を行います。
・あなたはユーザが提供した契約書について以下の3つの内容を成果物として回答します
　1.結果
　2.理由
　3.引用＝ユーザから提供された契約書のどこに記載があったかを説明すること
・不要な前置きや後書きは書かずに、結果とその理由と引用のみを成果物としてユーザに返答しなさい。

#リース識別手順:
  識別のタイミング: "契約の締結時にリースを含むかどうかを識別"
  
  識別の判断基準:
    説明: "契約が「特定された資産の使用を支配する権利を一定期間にわたり対価と交換に移転する」場合にリースと判断"
    基準:
      - 特定された資産
      - 使用を支配する権利の移転
  
  基準詳細:
    特定された資産:
      判断基準:
        - 特定されている: "契約に明記された資産である場合、特定された資産と判断"
        - 代替権の有無:
            条件:
              - "サプライヤーが使用期間を通じて他資産に代替する実質的な能力を持つ"
              - "サプライヤーが代替から経済的利益を得られる場合"
            結果: "顧客は特定された資産の使用を支配する権利を有していないと判断"
    
    使用を支配する権利の移転:
      条件:
        - 経済的利益の享受権: "顧客が資産の使用からの経済的利益をほぼ全て享受する権利がある"
        - 指図権: "顧客が資産の使用を指図する権利を有する"
      指図権の詳細:
        基準:
          - 使用方法の指図権: "使用期間を通じて経済的利益に影響を与える使用方法を顧客が指図する権利がある場合"
          - 使用方法の事前決定:
              条件:
                - "顧客が資産を稼働させる権利を有するか、第三者に指図して稼働させる権利を有する"
                - "資産が顧客の要望に応じて設計され、使用方法が事前に決定されている"

  識別の見直し:
    タイミング: "契約期間中、条件が変更されない限り識別判断を見直さない"

  リースと非リースの区分:
    借手と貸手の処理: "リースを含む契約は、リース部分と非リース部分を分けて会計処理"

以下はユーザが提供した契約書の内容です:
    
    ${pdfContent}
    `;
    
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "user",
                    content: prompt
                }
            ],
            temperature: 0.7
        });
        return response.choices[0].message.content;
    } catch (error) {
        console.error('Error:', error);
        throw new Error("OpenAI APIの呼び出しに失敗しました。");
    }
}

// POSTリクエストでファイルをアップロードし、PDF内容を分析するエンドポイント
app.post('/upload', upload.single('file'), async (req, res) => {
    try {
        console.log('アップロードされたファイルのMIMEタイプ:', req.file.mimetype);

        const filePath = req.file.path;
        const mimeType = req.file.mimetype;

        // ファイルの形式に応じてテキストを抽出
        let content;
        if (mimeType === 'application/pdf' || mimeType === 'application/octet-stream') {
            content = await extractTextFromPDF(filePath);
        } else {
            return res.status(400).send("サポートされていないファイル形式です。PDFファイルを使用してください。");
        }

        // OpenAI APIでPDF内容を分析
        const result = await analyzePDF(content);
        res.send(result);

        // アップロードされたファイルを削除
        fs.unlinkSync(filePath);
    } catch (error) {
        console.error('サーバー側でエラーが発生しました:', error);
        res.status(500).send("サーバー側でエラーが発生しました。");
    }
});

// 静的ファイルの提供（フロントエンド用のindex.htmlなど）
app.use(express.static(__dirname));

// サーバーを指定されたポートで起動
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`サーバーが起動しました: http://localhost:${PORT}`);
});
