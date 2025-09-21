/**
 * BSC链代币EMA多头排列监控器
 * 基于OKX DEX API文档实现
 * 功能：获取候选代币的5分钟粒度147根K线，检测EMA21>EMA55>EMA144多头排列信号，发送Telegram通知
 */

const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');

class BSCActiveTokensAnalyzer {
    constructor(apiKey, secretKey, passphrase) {
        this.apiKey = apiKey;
        this.secretKey = secretKey;
        this.passphrase = passphrase;
        this.baseUrl = 'https://web3.okx.com';
        this.bscChainIndex = '56'; // BSC链的chainIndex
        
        console.log('初始化BSC活跃代币分析器...');
    }

    /**
     * 生成API签名
     */
    generateSignature(timestamp, method, requestPath, body = '') {
        const message = timestamp + method + requestPath + body;
        const signature = crypto
            .createHmac('sha256', this.secretKey)
            .update(message)
            .digest('base64');
        return signature;
    }

    /**
     * 生成请求头
     */
    getHeaders(method, requestPath, body = '') {
        const timestamp = new Date().toISOString();
        const signature = this.generateSignature(timestamp, method, requestPath, body);
        
        return {
            'OK-ACCESS-KEY': this.apiKey,
            'OK-ACCESS-SIGN': signature,
            'OK-ACCESS-TIMESTAMP': timestamp,
            'OK-ACCESS-PASSPHRASE': this.passphrase,
            'Content-Type': 'application/json'
        };
    }

    /**
     * 延迟函数，避免API频率限制
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 发送Telegram消息
     */
    async sendTelegramMessage(message) {
        try {
            const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
            const chatId = process.env.TELEGRAM_CHAT_ID;
            
            if (!telegramToken || !chatId) {
                console.log('Telegram配置未设置，跳过消息发送');
                return false;
            }
            const url = `https://api.telegram.org/bot${telegramToken}/sendMessage`;
            
            const response = await axios.post(url, {
                chat_id: chatId,
                text: message,
                parse_mode: 'HTML'
            }, { timeout: 10000 });
            
            if (response.data.ok) {
                console.log('Telegram消息发送成功');
                return true;
            } else {
                console.error('Telegram消息发送失败:', response.data);
                return false;
            }
        } catch (error) {
            console.error('发送Telegram消息时出错:', error.message);
            return false;
        }
    }

    /**
     * 获取K线数据（5分钟粒度）
     */
    async getKlineData(tokenAddress, limit = 147) {
        try {
            const endpoint = '/api/v5/dex/market/candles';
            
            const params = new URLSearchParams({
                chainIndex: this.bscChainIndex,
                tokenContractAddress: tokenAddress.toLowerCase(),
                bar: '5m', // 5分钟粒度
                limit: limit.toString()
            });

            const requestPath = `${endpoint}?${params.toString()}`;
            const headers = this.getHeaders('GET', requestPath);
            const fullUrl = this.baseUrl + requestPath;

            const response = await axios.get(fullUrl, { headers, timeout: 10000 });
            await this.sleep(200);

            if (response.data.code === '0' && response.data.data) {
                // 返回格式：[ts, o, h, l, c, vol, volUsd, confirm]
                // 我们需要收盘价（索引4）
                return response.data.data.map(candle => ({
                    timestamp: parseInt(candle[0]),
                    open: parseFloat(candle[1]),
                    high: parseFloat(candle[2]),
                    low: parseFloat(candle[3]),
                    close: parseFloat(candle[4]),
                    volume: parseFloat(candle[5]),
                    volumeUsd: parseFloat(candle[6]),
                    confirm: candle[7]
                })).reverse(); // 按时间正序排列
            }
            return [];
        } catch (error) {
            console.error(`获取代币 ${tokenAddress} K线数据失败:`, error.message);
            return [];
        }
    }

    /**
     * 计算EMA（指数移动平均线）
     */
    calculateEMA(prices, period) {
        if (prices.length < period) {
            return [];
        }

        const ema = [];
        const multiplier = 2 / (period + 1);
        
        // 第一个EMA值使用SMA
        let sma = 0;
        for (let i = 0; i < period; i++) {
            sma += prices[i];
        }
        ema[period - 1] = sma / period;
        
        // 计算后续EMA值
        for (let i = period; i < prices.length; i++) {
            ema[i] = (prices[i] * multiplier) + (ema[i - 1] * (1 - multiplier));
        }
        
        return ema;
    }

    /**
     * 获取成交量前100的BSC代币列表（从JSON文件提取的合约地址）
     */
    getTopVolumeBSCTokens() {
        // 从成交量前100的代币中提取的合约地址
        const addresses = [
  "0xe6df05ce8c8301223373cf5b969afcb1498c5528",
  "0x000ae314e2a2172a039b26378814c252734f556a",
  "0xb994882a1b9bd98a71dd6ea5f61577c42848b0e8",
  "0x4fa7c69a7b69f8bc48233024d546bc299d6b03bf",
  "0x8dedf84656fa932157e27c060d8613824e7979e3",
  "0xa3cfb853339b77f385b994799b015cb04b208fe6",
  "0x78f5d389f5cdccfc41594abab4b0ed02f31398b3",
  "0x2c3a8ee94ddd97244a93bc48298f97d2c412f7db",
  "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82",
  "0x9123400446a56176eb1b6be9ee5cf703e409f492",
  "0x503fa24b7972677f00c4618e5fbe237780c1df53",
  "0xbe7e12b2e128bc955a0130ffb168f031d7dd8d58",
  "0xe747e54783ba3f77a8e5251a3cba19ebe9c0e197",
  "0x5ffd0eadc186af9512542d0d5e5eafc65d5afc5b",
  "0x40b8129b786d766267a7a118cf8c07e31cdb6fde",
  "0xd5df4d260d7a0145f655bcbf3b398076f21016c7",
  "0xde04da55b74435d7b9f2c5c62d9f1b53929b09aa",
  "0x932fb7f52adbc34ff81b4342b8c036b7b8ac4444",
  "0xfc5a743271672e91d77f0176e5cea581fbd5d834",
  "0xf486ad071f3bee968384d2e39e2d8af0fcf6fd46",
  "0xaf44a1e76f56ee12adbb7ba8acd3cbd474888122",
  "0x3fefe29da25bea166fb5f6ade7b5976d2b0e586b",
  "0xe3225e11cab122f1a126a28997788e5230838ab9",
  "0x61fac5f038515572d6f42d4bcb6b581642753d50",
  "0x01bf3d77cd08b19bf3f2309972123a2cca0f6936",
  "0x4e200fe2f3efb977d5fd9c430a41531fb04d97b8",
  "0x0f0df6cb17ee5e883eddfef9153fc6036bdb4e37",
  "0x90869b3a42e399951bd5f5ff278b8cc5ee1dc0fe",
  "0xd715cc968c288740028be20685263f43ed1e4837",
  "0x69dc50cf45a6bc7ac4c284d3d7383d4b96444444",
  "0x23fe903be385832fd7bb82bf1fee93f696278888",
  "0xd955c9ba56fb1ab30e34766e252a97ccce3d31a6",
  "0xfed13d0c40790220fbde712987079eda1ed75c51",
  "0x06c910d728499aa9aa7da39fb26ddc5dc6ea4444",
  "0xc9ccbd76c2353e593cc975f13295e8289d04d3bb",
  "0x899357e54c2c4b014ea50a9a7bf140ba6df2ec73",
  "0x1d58e204ca59328007469a614522903d69dc0a4c",
  "0x1aecab957bad4c6e36dd29c3d3bb470c4c29768a",
  "0x8fce7206e3043dd360f115afa956ee31b90b787c",
  "0xd82544bf0dfe8385ef8fa34d67e6e4940cc63e16",
  "0x48a18a4782b65a0fbed4dca608bb28038b7be339",
  "0x7d03759e5b41e36899833cb2e008455d69a24444",
  "0xf4c8e32eadec4bfe97e0f595add0f4450a863a11",
  "0xa45f5eb48cecd034751651aeeda6271bd5df8888",
  "0xff7d6a96ae471bbcd7713af9cb1feeb16cf56b41",
  "0x19ed254efa5e061d28d84650891a3db2a9940c16",
  "0xc9882def23bc42d53895b8361d0b1edc7570bc6a",
  "0xc1353d3ee02fdbd4f65f92eee543cfd709049cb1",
  "0x0e7779e698052f8fe56c415c3818fcf89de9ac6d",
  "0x238d72e179a581c98dc1996417a49818c7e509dc",
  "0x84575b87395c970f1f48e87d87a8db36ed653716",
  "0x9c8b5ca345247396bdfac0395638ca9045c6586e",
  "0x3aee7602b612de36088f3ffed8c8f10e86ebf2bf",
  "0xd6b48ccf41a62eb3891e58d0f006b19b01d50cca",
  "0xc07e1300dc138601fa6b0b59f8d0fa477e690589",
  "0xad8c787992428cd158e451aab109f724b6bc36de",
  "0x59537849f2a119ec698c7aa6c6daadc40c398a25",
  "0x2d060ef4d6bf7f9e5edde373ab735513c0e4f944",
  "0xa524b11473b7ce7eb1dc883a585e64471a734444",
  "0x3b4de3c7855c03bb9f50ea252cd2c9fa1125ab07",
  "0xa227cc36938f0c9e09ce0e64dfab226cad739447",
  "0xe32f9e8f7f7222fcd83ee0fc68baf12118448eaf",
  "0xf9ca3fe094212ffa705742d3626a8ab96aababf8",
  "0x4b0f1812e5df2a09796481ff14017e6005508003",
  "0xcae117ca6bc8a341d2e7207f30e180f0e5618b9d",
  "0x6bdcce4a559076e37755a78ce0c06214e59e4444",
  "0xf970706063b7853877f39515c96932d49d5ac9cd",
  "0xd23a186a78c0b3b805505e5f8ea4083295ef9f3a",
  "0x9beee89723ceec27d7c2834bec6834208ffdc202",
  "0xc61eb549acf4a05ed6e3fe0966f5e213b23541ce",
  "0x194b302a4b0a79795fb68e2adf1b8c9ec5ff8d1f",
  "0x46ee3bfc281d59009ccd06f1dd6abdbfcd82ffc3",
  "0x1e3dbc0aad9671fdd31e58b2fcc6cf1ca9947994",
  "0xfe723495f73714426493384eb5e49aa5b827e1d5",
  "0xb5b06b0e28bdc085754380dcbaa1044b3f8a94c9",
  "0x6cfffa5bfd4277a04d83307feedfe2d18d944dd2",
  "0x6e88056e8376ae7709496ba64d37fa2f8015ce3e",
  "0x783c3f003f172c6ac5ac700218a357d2d66ee2a2",
  "0xa5346f91a767b89a0363a4309c8e6c5adc0c4a59",
  "0x55ad16bd573b3365f43a9daeb0cc66a73821b4a5",
  "0x47474747477b199288bf72a1d702f7fe0fb1deea",
  "0x5845684b49aef79a5c0f887f50401c247dca7ac6",
  "0x001208f7f53f78db2b32e1c68198d3e8f320aa23",
  "0x17eafd08994305d8ace37efb82f1523177ec70ee",
  "0xa2be3e48170a60119b5f0400c65f65f3158fbeee",
  "0x953783617a71a888f8b04f397f2c9e1a7c37af7e",
  "0x15247e6e23d3923a853ccf15940a20ccdf16e94a",
  "0xb05f4747eb3d18a3fa4aa3e5c627f02ccc70d005",
  "0x5c85d6c6825ab4032337f11ee92a72df936b46f6",
  "0x5b73a93b4e5e4f1fd27d8b3f8c97d69908b5e284",
  "0x6d5ad1592ed9d6d1df9b93c793ab759573ed6714",
  "0x3ecb529752dec6c6ab08fd83e425497874e21d49",
  "0xba2ae424d960c26247dd6c32edc70b295c744c43",
  "0x6a2608dabe09bc1128eec7275b92dfb939d5db3f",
  "0x6894cde390a3f51155ea41ed24a33a4827d3063d",
  "0x8b194370825e37b33373e74a41009161808c1488",
  "0x8e1e6bf7e13c400269987b65ab2b5724b016caef",
  "0x6ea8211a1e47dbd8b55c487c0b906ebc57b94444",
  "0x1f34c87ded863fe3a3cd76fac8ada9608137c8c3",
  "0x0c78d4605c2972e5f989de9019de1fb00c5d3462"
];
        
        // 将地址转换为代币对象格式，使用地址的前8位作为临时符号
        return addresses.map((address, index) => ({
            symbol: `TOKEN_${index + 1}`,
            address: address
        }));
    }

    /**
     * 获取代币详细信息
     */
    async getTokenInfo(tokenAddress) {
        try {
            const endpoint = '/api/v5/dex/market/token';
            
            const params = new URLSearchParams({
                chainIndex: this.bscChainIndex,
                tokenContractAddress: tokenAddress.toLowerCase()
            });

            const requestPath = `${endpoint}?${params.toString()}`;
            const headers = this.getHeaders('GET', requestPath);
            const fullUrl = this.baseUrl + requestPath;

            const response = await axios.get(fullUrl, { headers, timeout: 10000 });
            await this.sleep(200);

            if (response.data.code === '0' && response.data.data && response.data.data.length > 0) {
                const tokenData = response.data.data[0];
                return {
                    name: tokenData.tokenName || 'Unknown',
                    symbol: tokenData.tokenSymbol || 'Unknown',
                    marketCap: tokenData.marketCap || '0',
                    volume24h: tokenData.volume24h || '0',
                    holderCount: tokenData.holderCount || '0'
                };
            }
            return null;
        } catch (error) {
            console.error(`获取代币信息失败 (${tokenAddress}):`, error.message);
            return null;
        }
    }

    /**
     * 检测EMA多头排列信号
     */
    async checkEMASignal(token) {
        console.log(`检测 ${token.symbol} 的EMA信号...`);
        
        const klineData = await this.getKlineData(token.address, 147);
        
        if (klineData.length < 144) {
            console.log(`${token.symbol} K线数据不足，跳过`);
            return null;
        }
        
        // 提取收盘价
        const closePrices = klineData.map(candle => candle.close);
        
        // 计算EMA
        const ema21 = this.calculateEMA(closePrices, 21);
        const ema55 = this.calculateEMA(closePrices, 55);
        const ema144 = this.calculateEMA(closePrices, 144);
        
        // 获取最新和前一根K线的EMA值
        const latestIndex = closePrices.length - 1;
        const prevIndex = latestIndex - 1;
        
        const latestEMA21 = ema21[latestIndex];
        const latestEMA55 = ema55[latestIndex];
        const latestEMA144 = ema144[latestIndex];
        
        const prevEMA21 = ema21[prevIndex];
        const prevEMA55 = ema55[prevIndex];
        const prevEMA144 = ema144[prevIndex];
        
        // 打印EMA值
        console.log(`${token.symbol} EMA值 - EMA21: ${latestEMA21.toFixed(8)}, EMA55: ${latestEMA55.toFixed(8)}, EMA144: ${latestEMA144.toFixed(8)}`);
        
        // 检查最新K线是否满足多头排列：EMA21 > EMA55 > EMA144
        const currentBullish = latestEMA21 > latestEMA55 && latestEMA55 > latestEMA144;
        
        // 检查前一根K线是否不满足多头排列
        const prevNotBullish = !(prevEMA21 > prevEMA55 && prevEMA55 > prevEMA144);
        
        console.log(`${token.symbol} - 当前多头排列: ${currentBullish}, 前一根非多头排列: ${prevNotBullish}`);
        console.log(`${token.symbol} - EMA判断结果: EMA21(${latestEMA21.toFixed(8)}) > EMA55(${latestEMA55.toFixed(8)}) = ${latestEMA21 > latestEMA55}, EMA55(${latestEMA55.toFixed(8)}) > EMA144(${latestEMA144.toFixed(8)}) = ${latestEMA55 > latestEMA144}`);
        
        // 如果当前满足多头排列且前一根不满足，则触发信号
        if (currentBullish && prevNotBullish) {
            console.log(`🚀 ${token.symbol} 触发EMA多头排列信号！`);
            
            // 获取代币详细信息
            const tokenInfo = await this.getTokenInfo(token.address);
            
            return {
                symbol: token.symbol,
                address: token.address,
                tokenInfo: tokenInfo,
                latestPrice: closePrices[latestIndex],
                ema21: latestEMA21,
                ema55: latestEMA55,
                ema144: latestEMA144,
                timestamp: new Date().toISOString()
            };
        }
        
        return null;
    }



    /**
     * 运行EMA多头排列监控
     */
    async runAnalysis() {
        try {
            console.log('=== BSC链EMA多头排列监控开始 ===');
            
            const candidateTokens = this.getTopVolumeBSCTokens();
            const signalTokens = [];
            
            console.log(`开始检测 ${candidateTokens.length} 个候选代币的EMA信号...`);
            
            // 检查每个代币的EMA信号
            for (let i = 0; i < candidateTokens.length; i++) {
                const token = candidateTokens[i];
                console.log(`\n检测代币 ${token.symbol} (${i + 1}/${candidateTokens.length})...`);
                
                const signal = await this.checkEMASignal(token);
                
                if (signal) {
                    signalTokens.push(signal);
                    
                    // 发送Telegram通知
                    const message = this.formatTelegramMessage(signal);
                    await this.sendTelegramMessage(message);
                    
                    console.log(`✅ ${token.symbol} 信号已发送到Telegram`);
                }
                
                // 每个代币检测后延迟0.5秒
                await this.sleep(500);
            }
            
            console.log(`\n=== 监控完成 ===`);
            console.log(`检测了 ${candidateTokens.length} 个代币`);
            console.log(`发现 ${signalTokens.length} 个EMA多头排列信号`);
            
            if (signalTokens.length > 0) {
                console.log('发现的信号:');
                signalTokens.forEach((signal, index) => {
                    console.log(`${index + 1}. ${signal.symbol} (${signal.address})`);
                    console.log(`   当前价格: ${signal.latestPrice}`);
                    console.log(`   EMA21: ${signal.ema21.toFixed(8)}, EMA55: ${signal.ema55.toFixed(8)}, EMA144: ${signal.ema144.toFixed(8)}`);
                });
            }
            
            return {
                timestamp: new Date().toISOString(),
                chain: 'BSC',
                totalTokensChecked: candidateTokens.length,
                signalsFound: signalTokens.length,
                signals: signalTokens
            };
            
        } catch (error) {
            console.error('监控过程中发生错误:', error);
            throw error;
        }
    }
    
    /**
     * 格式化Telegram消息
     */
    formatTelegramMessage(signal) {
        const tokenInfo = signal.tokenInfo;
        
        let message = `🚀 <b>EMA多头排列信号</b>\n\n`;
        message += `📊 <b>代币信息:</b>\n`;
        message += `• 名称: ${tokenInfo?.name || 'Unknown'}\n`;
        message += `• 符号: ${signal.symbol}\n`;
        message += `• 合约地址: <code>${signal.address}</code>\n\n`;
        
        message += `💰 <b>市场数据:</b>\n`;
        message += `• 市值: $${this.formatNumber(tokenInfo?.marketCap || '0')}\n`;
        message += `• 24h成交量: $${this.formatNumber(tokenInfo?.volume24h || '0')}\n`;
        message += `• 持币地址数: ${this.formatNumber(tokenInfo?.holderCount || '0')}\n\n`;
        
        message += `📈 <b>EMA指标:</b>\n`;
        message += `• EMA21: ${signal.ema21.toFixed(8)}\n`;
        message += `• EMA55: ${signal.ema55.toFixed(8)}\n`;
        message += `• EMA144: ${signal.ema144.toFixed(8)}\n`;
        message += `• 当前价格: ${signal.latestPrice.toFixed(8)}\n\n`;
        
        message += `⏰ 时间: ${signal.timestamp}`;
        
        return message;
    }
    
    /**
     * 格式化数字显示
     */
    formatNumber(numStr) {
        const num = parseFloat(numStr);
        if (isNaN(num)) return '0';
        
        if (num >= 1e9) {
            return (num / 1e9).toFixed(2) + 'B';
        } else if (num >= 1e6) {
            return (num / 1e6).toFixed(2) + 'M';
        } else if (num >= 1e3) {
            return (num / 1e3).toFixed(2) + 'K';
        } else {
            return num.toFixed(2);
        }
    }
}

// 配置信息 - 从环境变量读取
const CONFIG = {
    OKX_API_KEY: process.env.OKX_API_KEY,
    OKX_SECRET_KEY: process.env.OKX_SECRET_KEY,
    OKX_API_PASSPHRASE: process.env.OKX_API_PASSPHRASE
};

// 检查必要的环境变量
function checkConfig() {
    const requiredVars = ['OKX_API_KEY', 'OKX_SECRET_KEY', 'OKX_API_PASSPHRASE'];
    const missing = requiredVars.filter(varName => !process.env[varName]);
    
    if (missing.length > 0) {
        console.error('❌ 缺少必要的环境变量:', missing.join(', '));
        console.error('请在 .env 文件或环境变量中设置这些值');
        process.exit(1);
    }
    
    console.log('✅ OKX API 配置检查通过');
}

// 主函数
async function main() {
    try {
        // 检查配置
        checkConfig();
        
        const analyzer = new BSCActiveTokensAnalyzer(
            CONFIG.OKX_API_KEY,
            CONFIG.OKX_SECRET_KEY,
            CONFIG.OKX_API_PASSPHRASE
        );
        
        console.log('=== 启动EMA多头排列监控服务 ===');
        console.log('每5分钟检测一次，按Ctrl+C停止服务');
        
        // 立即执行一次
        await analyzer.runAnalysis();
        
        // 每5分钟执行一次
        setInterval(async () => {
            try {
                console.log('\n=== 开始新一轮检测 ===');
                await analyzer.runAnalysis();
            } catch (error) {
                console.error('检测过程中出错:', error.message);
            }
        }, 5 * 60 * 1000); // 5分钟 = 5 * 60 * 1000 毫秒
        
    } catch (error) {
        console.error('程序执行失败:', error.message);
        process.exit(1);
    }
}

// 如果直接运行此文件，执行主函数
if (require.main === module) {
    main();
}

module.exports = BSCActiveTokensAnalyzer;
