/**
 * BSC链代币EMA多头排列监控器
 * 基于OKX DEX API文档实现
 * 功能：获取候选代币的15分钟粒度147根K线，检测EMA21>EMA55>EMA144多头排列信号，发送Telegram通知
 */

// 加载环境变量
require('dotenv').config();

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
        
        // 初始化缓存
        this.klineCache = new Map(); // 存储每个代币的144根K线数据
        this.emaStatusCache = new Map(); // 存储每个代币的EMA状态历史
        this.isInitialized = false; // 标记是否已完成初始化
        
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
                console.log('❌ Telegram配置未设置，跳过消息发送');
                console.log('请检查环境变量: TELEGRAM_BOT_TOKEN 和 TELEGRAM_CHAT_ID');
                return false;
            }
            
            // 验证Token格式 (应该类似: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz)
            if (!telegramToken.includes(':') || telegramToken.length < 35) {
                console.error('❌ Telegram Bot Token格式不正确');
                console.log('正确格式应该是: 数字:字母数字组合，例如: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz');
                return false;
            }
            
            // 验证Chat ID格式 (应该是数字或以-开头的数字)
            if (!/^-?\d+$/.test(chatId)) {
                console.error('❌ Telegram Chat ID格式不正确');
                console.log('Chat ID应该是纯数字或负数，例如: 123456789 或 -123456789');
                return false;
            }
            
            const url = `https://api.telegram.org/bot${telegramToken}/sendMessage`;
            console.log(`📤 正在发送Telegram消息到Chat ID: ${chatId}`);
            
            const response = await axios.post(url, {
                chat_id: chatId,
                text: message,
                parse_mode: 'HTML'
            }, { timeout: 10000 });
            
            if (response.data.ok) {
                console.log('✅ Telegram消息发送成功');
                return true;
            } else {
                console.error('❌ Telegram消息发送失败:', response.data);
                return false;
            }
        } catch (error) {
            console.error('❌ 发送Telegram消息时出错:', error.message);
            
            // 详细的错误诊断
            if (error.response) {
                console.error('HTTP状态码:', error.response.status);
                console.error('错误详情:', error.response.data);
                
                if (error.response.status === 404) {
                    console.error('🔍 404错误诊断:');
                    console.error('1. 检查Bot Token是否正确 (格式: 数字:字母数字)');
                    console.error('2. 确认Bot是否已通过@BotFather创建');
                    console.error('3. 验证Bot Token是否有效');
                    console.error('4. 检查网络连接是否正常');
                } else if (error.response.status === 400) {
                    console.error('🔍 400错误诊断:');
                    console.error('1. 检查Chat ID是否正确');
                    console.error('2. 确认用户是否已与Bot开始对话');
                    console.error('3. 验证消息格式是否正确');
                } else if (error.response.status === 401) {
                    console.error('🔍 401错误诊断:');
                    console.error('1. Bot Token无效或已过期');
                    console.error('2. 请重新从@BotFather获取Token');
                }
            } else if (error.code === 'ENOTFOUND') {
                console.error('🔍 网络错误: 无法连接到Telegram服务器');
                console.error('请检查网络连接');
            } else if (error.code === 'ETIMEDOUT') {
                console.error('🔍 超时错误: 请求超时');
                console.error('请检查网络连接或稍后重试');
            }
            
            return false;
        }
    }

    /**
     * 获取K线数据（15分钟粒度）- 修改为只获取144根
     */
    async getKlineData(tokenAddress, limit = 144) {
        try {
            const endpoint = '/api/v5/dex/market/historical-candles';
            
            // 只请求144根K线数据
            const params = new URLSearchParams({
                chainIndex: this.bscChainIndex,
                tokenContractAddress: tokenAddress.toLowerCase(),
                bar: '15m', // 15分钟粒度
                limit: limit.toString()
            });

            const requestPath = `${endpoint}?${params.toString()}`;
            const headers = this.getHeaders('GET', requestPath);
            const fullUrl = this.baseUrl + requestPath;

            // 配置axios请求选项，包含代理和更详细的错误处理
            const axiosConfig = {
                headers,
                timeout: 30000, // 增加超时时间到30秒
                // 如果需要代理，可以在这里配置
                // proxy: {
                //     host: '127.0.0.1',
                //     port: 7890
                // }
            };

            console.log(`正在请求K线数据: ${fullUrl}`);
            const response = await axios.get(fullUrl, axiosConfig);
            await this.sleep(200);

            if (response.data.code === '0' && response.data.data) {
                // 历史K线API返回格式：[ts, o, h, l, c, vol, volUsd]
                // 历史K线API只返回已收盘的K线数据，不包含confirm字段
                const candles = response.data.data.map(candle => ({
                    timestamp: parseInt(candle[0]),
                    open: parseFloat(candle[1]),
                    high: parseFloat(candle[2]),
                    low: parseFloat(candle[3]),
                    close: parseFloat(candle[4]),
                    volume: parseFloat(candle[5]),
                    volumeUsd: parseFloat(candle[6])
                })).reverse(); // 按时间正序排列
                
                console.log(`${tokenAddress}: 请求 ${limit} 根K线，实际获取到 ${candles.length} 根历史K线数据（均为已收盘）`);
                
                // 直接返回所有获取到的K线数据
                return candles;
            }
            return [];
        } catch (error) {
            console.error(`获取代币 ${tokenAddress} K线数据失败:`, error.message);
            return [];
        }
    }

    /**
     * 初始化所有代币的K线数据缓存
     */
    async initializeKlineCache() {
        console.log('🔄 开始初始化K线数据缓存...');
        const tokens = this.getTopVolumeBSCTokens();
        
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            console.log(`初始化 ${token.symbol} (${i + 1}/${tokens.length}) 的K线数据...`);
            
            const klineData = await this.getKlineData(token.address, 144);
            if (klineData.length >= 144) {
                // 存储144根K线数据到缓存
                this.klineCache.set(token.address, klineData);
                
                // 计算并存储初始EMA状态
                const emaStatus = this.calculateEMAStatus(klineData);
                if (emaStatus) {
                    const statusKey = `${token.address}_${emaStatus.timestamp}_prev`;
                    this.emaStatusCache.set(statusKey, emaStatus.bullish);
                    console.log(`${token.symbol} 初始EMA状态: ${emaStatus.bullish ? '多头排列' : '非多头排列'}`);
                }
            } else {
                console.log(`${token.symbol} K线数据不足144根，跳过`);
            }
            
            // 避免API频率限制
            await this.sleep(300);
        }
        
        this.isInitialized = true;
        console.log('✅ K线数据缓存初始化完成');
    }

    /**
     * 计算EMA状态（ema21 > ema55 > ema144）
     */
    calculateEMAStatus(klineData) {
        if (klineData.length < 144) {
            return null;
        }
        
        // 提取收盘价
        const closePrices = klineData.map(candle => candle.close);
        
        // 计算EMA
        const ema21 = this.calculateEMA(closePrices, 21);
        const ema55 = this.calculateEMA(closePrices, 55);
        const ema144 = this.calculateEMA(closePrices, 144);
        
        // 获取最新K线的EMA值
        const latestIndex = closePrices.length - 1;
        const latestEMA21 = ema21[latestIndex];
        const latestEMA55 = ema55[latestIndex];
        const latestEMA144 = ema144[latestIndex];
        
        // 检查EMA值是否有效
        if (latestEMA21 === null || latestEMA55 === null || latestEMA144 === null) {
            return null;
        }
        
        // 判断是否为多头排列
        const bullish = latestEMA21 > latestEMA55 && latestEMA55 > latestEMA144;
        
        return {
            bullish,
            ema21: latestEMA21,
            ema55: latestEMA55,
            ema144: latestEMA144,
            timestamp: klineData[latestIndex].timestamp,
            price: closePrices[latestIndex]
        };
    }

    /**
     * 更新单个代币的K线数据缓存
     */
    async updateTokenKlineCache(tokenAddress) {
        try {
            // 获取最新的K线数据（只获取1根最新的）
            const latestKline = await this.getKlineData(tokenAddress, 1);
            if (latestKline.length === 0) {
                console.log(`${tokenAddress} 无法获取最新K线数据`);
                return null;
            }
            
            const newCandle = latestKline[0];
            const cachedKlines = this.klineCache.get(tokenAddress);
            
            if (!cachedKlines || cachedKlines.length === 0) {
                console.log(`${tokenAddress} 缓存中无K线数据，跳过更新`);
                return null;
            }
            
            // 检查是否是新的K线（时间戳不同）
            const lastCachedCandle = cachedKlines[cachedKlines.length - 1];
            if (newCandle.timestamp <= lastCachedCandle.timestamp) {
                console.log(`${tokenAddress} 没有新的K线数据`);
                return null;
            }
            
            // 添加新K线，删除最旧的K线，保持144根
            const updatedKlines = [...cachedKlines.slice(1), newCandle];
            this.klineCache.set(tokenAddress, updatedKlines);
            
            console.log(`${tokenAddress} K线缓存已更新，新K线时间: ${new Date(newCandle.timestamp).toISOString()}`);
            
            return updatedKlines;
        } catch (error) {
            console.error(`更新 ${tokenAddress} K线缓存失败:`, error.message);
            return null;
        }
    }
    /**
     * 计算EMA（指数移动平均线）
     */
    calculateEMA(prices, period) {
        if (prices.length < period) {
            return [];
        }

        const ema = new Array(prices.length);
        const multiplier = 2 / (period + 1);
        
        // 前面的值设为null，表示无效
        for (let i = 0; i < period - 1; i++) {
            ema[i] = null;
        }
        
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
     * 获取代币详细信息（带重试机制）
     * 使用OKX DEX API的代币交易信息接口
     */
    async getTokenInfo(tokenAddress, maxRetries = 3) {
        // 首先尝试从代币列表API获取真实的代币名称和符号
        const tokenListInfo = await this.getTokenFromList(tokenAddress, maxRetries);
        
        // 然后获取价格信息
        const priceInfo = await this.getTokenPriceInfo(tokenAddress, maxRetries);
        
        // 合并信息
        return {
            name: tokenListInfo.name || `Token_${tokenAddress.slice(0, 8)}`,
            symbol: tokenListInfo.symbol || `TOKEN_${tokenAddress.slice(-4).toUpperCase()}`,
            marketCap: priceInfo.marketCap || '0',
            volume24h: priceInfo.volume24h || '0',
            holderCount: priceInfo.holderCount || '0',
            price: priceInfo.price || '0'
        };
    }

    /**
     * 从OKX代币列表API获取代币的真实名称和符号
     */
    async getTokenFromList(tokenAddress, maxRetries = 3) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`从代币列表获取信息 ${tokenAddress} (尝试 ${attempt}/${maxRetries})...`);
                
                const endpoint = '/api/v5/defi/explore/token/list';
                const params = new URLSearchParams({
                    tokenAddress: tokenAddress.toLowerCase(),
                    chainId: '56' // BSC链ID
                });
                
                const headers = this.getHeaders('GET', `${endpoint}?${params.toString()}`);
                const fullUrl = `${this.baseUrl}${endpoint}?${params.toString()}`;

                // 配置axios请求选项
                const axiosConfig = {
                    headers,
                    timeout: 30000, // 增加超时时间
                    // 如果需要代理，可以在这里配置
                    // proxy: {
                    //     host: '127.0.0.1',
                    //     port: 7890
                    // }
                };

                const response = await axios.get(fullUrl, axiosConfig);
                await this.sleep(300);

                console.log(`代币列表API响应状态: ${response.status}, 代码: ${response.data?.code}`);
                
                if (response.data.code === 0 && response.data.data && response.data.data.length > 0) {
                    const tokenData = response.data.data[0];
                    if (tokenData.tokenInfos && tokenData.tokenInfos.length > 0) {
                        // 查找BSC网络的代币信息
                        const bscToken = tokenData.tokenInfos.find(info => 
                            info.network === 'BSC' && 
                            info.tokenAddress.toLowerCase() === tokenAddress.toLowerCase()
                        );
                        
                        if (bscToken) {
                            console.log(`找到真实代币信息: ${bscToken.tokenSymbol}`);
                            return {
                                name: bscToken.tokenSymbol, // 使用符号作为名称
                                symbol: bscToken.tokenSymbol
                            };
                        }
                    }
                }
                
                console.log(`代币列表API未找到 ${tokenAddress} 的信息`);
                break; // 如果API调用成功但没找到数据，不需要重试
                
            } catch (error) {
                console.error(`代币列表API调用失败 (${tokenAddress}) 尝试 ${attempt}/${maxRetries}:`, error.message);
                
                if (attempt === maxRetries) {
                    console.log(`代币列表API所有重试都失败，使用默认命名`);
                }
                
                await this.sleep(1000 * attempt);
            }
        }
        
        // 返回默认信息
        return {
            name: `Token_${tokenAddress.slice(0, 8)}`,
            symbol: `TOKEN_${tokenAddress.slice(-4).toUpperCase()}`
        };
    }

    /**
     * 获取代币价格信息
     */
    async getTokenPriceInfo(tokenAddress, maxRetries = 3) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`获取代币价格信息 ${tokenAddress} (尝试 ${attempt}/${maxRetries})...`);
                
                const endpoint = '/api/v5/dex/market/price-info';
                
                // 构建请求体，使用POST方法
                const requestBody = JSON.stringify([{
                    chainIndex: this.bscChainIndex,
                    tokenContractAddress: tokenAddress.toLowerCase()
                }]);

                const headers = this.getHeaders('POST', endpoint, requestBody);
                const fullUrl = this.baseUrl + endpoint;

                // 配置axios请求选项
                const axiosConfig = {
                    headers,
                    timeout: 30000, // 增加超时时间
                    // 如果需要代理，可以在这里配置
                    // proxy: {
                    //     host: '127.0.0.1',
                    //     port: 7890
                    // }
                };

                const response = await axios.post(fullUrl, requestBody, axiosConfig);
                await this.sleep(300);

                console.log(`价格API响应状态: ${response.status}, 代码: ${response.data?.code}`);
                
                if (response.data.code === '0') {
                    if (response.data.data && response.data.data.length > 0) {
                        const tokenData = response.data.data[0];
                        console.log(`代币价格数据:`, JSON.stringify(tokenData, null, 2));
                        
                        return {
                            marketCap: tokenData.marketCap || '0',
                            volume24h: tokenData.volume24H || '0',
                            holderCount: tokenData.holders || '0',
                            price: tokenData.price || '0'
                        };
                    } else {
                        console.log(`代币 ${tokenAddress} 未找到价格数据`);
                        return {
                            marketCap: '数据获取中',
                            volume24h: '数据获取中',
                            holderCount: '数据获取中',
                            price: '0'
                        };
                    }
                } else {
                    console.error(`价格API返回错误代码: ${response.data.code}, 消息: ${response.data.msg}`);
                    if (attempt === maxRetries) {
                        return {
                            marketCap: '获取失败',
                            volume24h: '获取失败',
                            holderCount: '获取失败',
                            price: '0'
                        };
                    }
                }
            } catch (error) {
                console.error(`获取代币价格信息失败 (${tokenAddress}) 尝试 ${attempt}/${maxRetries}:`, error.message);
                
                if (attempt === maxRetries) {
                    console.error(`价格API所有重试都失败，返回默认信息`);
                    return {
                        marketCap: '获取失败',
                        volume24h: '获取失败',
                        holderCount: '获取失败',
                        price: '0'
                    };
                }
                
                await this.sleep(1000 * attempt);
            }
        }
        
        return {
            marketCap: '获取失败',
            volume24h: '获取失败',
            holderCount: '获取失败',
            price: '0'
        };
    }
    
    /**
     * 获取默认代币信息
     */
    getDefaultTokenInfo(tokenAddress) {
        return {
            name: `Token_${tokenAddress.slice(0, 8)}`,
            symbol: `TOKEN_${tokenAddress.slice(-4).toUpperCase()}`,
            marketCap: '数据获取失败',
            volume24h: '数据获取失败',
            holderCount: '数据获取失败',
            price: '0'
        };
    }

    /**
     * 检测EMA多头排列信号
     */
    /**
     * 检测多头信号（新的EMA判断逻辑）
     */
    async checkBullishSignal(tokenAddress, tokenSymbol) {
        try {
            // 获取缓存的K线数据
            const cachedKlines = this.klineCache.get(tokenAddress);
            if (!cachedKlines || cachedKlines.length < 144) {
                console.log(`${tokenSymbol} 缓存中K线数据不足，跳过检测`);
                return null;
            }
            
            // 计算当前K线的EMA状态
            const currentEMAStatus = this.calculateEMAStatus(cachedKlines);
            if (!currentEMAStatus) {
                console.log(`${tokenSymbol} 无法计算EMA状态`);
                return null;
            }
            
            // 获取上一根K线的EMA状态
            const prevTimestamp = cachedKlines[cachedKlines.length - 2].timestamp;
            const prevStatusKey = `${tokenAddress}_${prevTimestamp}_prev`;
            const prevBullishStatus = this.emaStatusCache.get(prevStatusKey);
            
            console.log(`${tokenSymbol} EMA状态检查:`);
            console.log(`  当前EMA21: ${currentEMAStatus.ema21.toFixed(8)}`);
            console.log(`  当前EMA55: ${currentEMAStatus.ema55.toFixed(8)}`);
            console.log(`  当前EMA144: ${currentEMAStatus.ema144.toFixed(8)}`);
            console.log(`  当前多头排列: ${currentEMAStatus.bullish}`);
            console.log(`  上一根多头排列: ${prevBullishStatus}`);
            
            // 存储当前K线的EMA状态
            const currentStatusKey = `${tokenAddress}_${currentEMAStatus.timestamp}_prev`;
            this.emaStatusCache.set(currentStatusKey, currentEMAStatus.bullish);
            
            // 检查多头信号：上一根为false，当前为true
            if (prevBullishStatus === false && currentEMAStatus.bullish === true) {
                console.log(`🚀 ${tokenSymbol} 检测到多头信号！`);
                
                // 获取代币详细信息
                const tokenInfo = await this.getTokenInfo(tokenAddress);
                
                return {
                    symbol: tokenSymbol,
                    address: tokenAddress,
                    tokenInfo: tokenInfo,
                    currentPrice: currentEMAStatus.price,
                    ema21: currentEMAStatus.ema21,
                    ema55: currentEMAStatus.ema55,
                    ema144: currentEMAStatus.ema144,
                    signalReason: '多头排列信号：上一根K线非多头排列，当前K线形成多头排列',
                    timestamp: new Date().toISOString(),
                    klineTimestamp: currentEMAStatus.timestamp
                };
            }
            
            // 清理旧的EMA状态缓存（保留最近10个状态）
            this.cleanupEMAStatusCache(tokenAddress);
            
            return null;
        } catch (error) {
            console.error(`检测 ${tokenSymbol} 多头信号失败:`, error.message);
            return null;
        }
    }

    /**
     * 清理EMA状态缓存
     */
    cleanupEMAStatusCache(tokenAddress) {
        const keys = Array.from(this.emaStatusCache.keys())
            .filter(key => key.startsWith(tokenAddress))
            .sort((a, b) => {
                const timestampA = parseInt(a.split('_')[1]);
                const timestampB = parseInt(b.split('_')[1]);
                return timestampB - timestampA; // 降序排列
            });
        
        // 只保留最近10个状态
        if (keys.length > 10) {
            const keysToDelete = keys.slice(10);
            keysToDelete.forEach(key => this.emaStatusCache.delete(key));
        }
    }

    /**
     * 定时任务：每15分钟第10秒执行
     */
    startScheduledTask() {
        console.log('🕐 启动定时任务：每15分钟第10秒检测多头信号');
        
        setInterval(async () => {
            const now = new Date();
            const minutes = now.getMinutes();
            const seconds = now.getSeconds();
            
            // 每15分钟的第10秒执行（0:10, 5:10, 10:10, 15:10, 20:10, 25:10, 30:10, 35:10, 40:10, 45:10, 50:10, 55:10）
            if (minutes % 5 === 0 && seconds === 10) {
                console.log(`\n⏰ ${now.toISOString()} - 开始执行定时检测任务`);
                await this.runScheduledAnalysis();
            }
        }, 1000); // 每秒检查一次
    }

    /**
     * 执行定时分析任务
     */
    async runScheduledAnalysis() {
        if (!this.isInitialized) {
            console.log('❌ 系统未初始化，跳过定时任务');
            return;
        }
        
        const tokens = this.getTopVolumeBSCTokens();
        console.log(`🔍 开始检测 ${tokens.length} 个代币的多头信号...`);
        
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            
            try {
                // 更新K线缓存
                const updatedKlines = await this.updateTokenKlineCache(token.address);
                if (updatedKlines) {
                    // 检测多头信号
                    const signal = await this.checkBullishSignal(token.address, token.symbol);
                    if (signal) {
                        // 发送Telegram消息
                        const message = this.formatTelegramMessage(signal);
                        await this.sendTelegramMessage(message);
                    }
                }
                
                // 避免API频率限制
                await this.sleep(200);
            } catch (error) {
                console.error(`处理代币 ${token.symbol} 时出错:`, error.message);
            }
        }
        
        console.log('✅ 定时检测任务完成\n');
    }

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
                    console.log(`   当前价格: ${signal.currentPrice}`);
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

    async checkEMASignal(token) {
        try {
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
            
            // 获取最新和前几根K线的EMA值用于趋势分析
            const latestIndex = closePrices.length - 1;
            const prevIndex = latestIndex - 1;
            const prev2Index = latestIndex - 2;
            const prev3Index = latestIndex - 3;
            
            // 检查EMA值是否有效（不为null）
            if (ema21[latestIndex] === null || ema21[prev3Index] === null ||
                ema55[latestIndex] === null || ema55[prev3Index] === null ||
                ema144[latestIndex] === null || ema144[prev3Index] === null) {
                console.log(`${token.symbol} EMA数据不足，跳过`);
                return null;
            }
            
            const latestEMA21 = ema21[latestIndex];
            const latestEMA55 = ema55[latestIndex];
            const latestEMA144 = ema144[latestIndex];
            
            const prevEMA21 = ema21[prevIndex];
            const prevEMA55 = ema55[prevIndex];
            const prevEMA144 = ema144[prevIndex];
            
            // 打印当前K线EMA值
            console.log(`${token.symbol} 当前K线EMA值 - EMA21: ${latestEMA21.toFixed(8)}, EMA55: ${latestEMA55.toFixed(8)}, EMA144: ${latestEMA144.toFixed(8)}`);
            
            // 检查当前是否满足多头排列：EMA21 > EMA55 > EMA144
            const currentBullish = latestEMA21 > latestEMA55 && latestEMA55 > latestEMA144;
            
            // 检查EMA趋势方向（是否向上）
            const ema21Rising = latestEMA21 > ema21[prev2Index] && ema21[prev2Index] > ema21[prev3Index];
            const ema55Rising = latestEMA55 > ema55[prev2Index];
            const ema144Rising = latestEMA144 > ema144[prev3Index];
            
            // 检查价格相对于EMA的位置
            const priceAboveEMA21 = closePrices[latestIndex] > latestEMA21;
            const priceAboveEMA55 = closePrices[latestIndex] > latestEMA55;
            
            // 计算EMA之间的距离（用于判断排列的强度）
            const ema21_55_gap = (latestEMA21 - latestEMA55) / latestEMA55;
            const ema55_144_gap = (latestEMA55 - latestEMA144) / latestEMA144;
            
            // 检查最近几根K线的多头排列情况
            const recentBullishCount = [latestIndex, prevIndex, prev2Index].filter(i => 
                ema21[i] > ema55[i] && ema55[i] > ema144[i]
            ).length;
            
            console.log(`${token.symbol} - 多头排列分析:`);
            console.log(`  当前多头排列: ${currentBullish}`);
            console.log(`  EMA21上升趋势: ${ema21Rising}`);
            console.log(`  EMA55上升趋势: ${ema55Rising}`);
            console.log(`  EMA144上升趋势: ${ema144Rising}`);
            console.log(`  价格高于EMA21: ${priceAboveEMA21}`);
            console.log(`  价格高于EMA55: ${priceAboveEMA55}`);
            console.log(`  EMA21-55间距: ${(ema21_55_gap * 100).toFixed(3)}%`);
            console.log(`  EMA55-144间距: ${(ema55_144_gap * 100).toFixed(3)}%`);
            console.log(`  最近3根K线多头排列数量: ${recentBullishCount}`);
            
            // 优化的信号触发条件
            let signalTriggered = false;
            let signalReason = '';
            
            // 条件1: 刚形成多头排列且趋势向上
            if (currentBullish && ema21Rising && ema55Rising && 
                recentBullishCount >= 1 && recentBullishCount <= 2) {
                signalTriggered = true;
                signalReason = '刚形成多头排列且趋势向上';
            }
            
            // 条件2: 多头排列稳定且价格突破EMA21
            else if (currentBullish && recentBullishCount >= 2 && 
                     priceAboveEMA21 && priceAboveEMA55 &&
                     ema21_55_gap > 0.001 && ema55_144_gap > 0.001) {
                signalTriggered = true;
                signalReason = '多头排列稳定且价格强势突破';
            }
            
            // 条件3: EMA21向上穿越EMA55（金叉）
            else if (latestEMA21 > latestEMA55 && prevEMA21 <= prevEMA55 && 
                     ema21Rising && priceAboveEMA21) {
                signalTriggered = true;
                signalReason = 'EMA21向上穿越EMA55(金叉)';
            }
            
            if (signalTriggered) {
                console.log(`🚀 ${token.symbol} 触发EMA信号！原因: ${signalReason}`);
                
                // 获取代币详细信息
                const tokenInfo = await this.getTokenInfo(token.address);
                
                return {
                    symbol: token.symbol,
                    address: token.address,
                    tokenInfo: tokenInfo,
                    currentPrice: closePrices[latestIndex],
                    ema21: latestEMA21,
                    ema55: latestEMA55,
                    ema144: latestEMA144,
                    signalReason: signalReason,
                    trendStrength: {
                        ema21Rising,
                        ema55Rising,
                        ema144Rising,
                        priceAboveEMA21,
                        priceAboveEMA55,
                        ema21_55_gap: ema21_55_gap * 100,
                        ema55_144_gap: ema55_144_gap * 100,
                        recentBullishCount
                    },
                    timestamp: new Date().toISOString(),
                    klineTimestamp: klineData[latestIndex].timestamp
                };
            }
            
            return null;
        } catch (error) {
            console.error(`检测 ${token.symbol} 时出错:`, error.message);
            return null;
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
        message += `• 符号: ${tokenInfo?.symbol || signal.symbol}\n`;
        message += `• 合约地址: <code>${signal.address}</code>\n\n`;

        message += `💰 <b>市场数据:</b>\n`;
        message += `• 市值: $${this.formatNumber(tokenInfo?.marketCap || '0')}\n`;
        message += `• 24h成交量: $${this.formatNumber(tokenInfo?.volume24h || '0')}\n`;
        message += `• 持币地址数: ${this.formatNumber(tokenInfo?.holderCount || '0')}\n\n`;

        message += `📈 <b>EMA指标:</b>\n`;
        message += `• EMA21: ${signal.ema21.toFixed(8)}\n`;
        message += `• EMA55: ${signal.ema55.toFixed(8)}\n`;
        message += `• EMA144: ${signal.ema144.toFixed(8)}\n`;
        message += `• 当前价格: ${signal.currentPrice.toFixed(8)}\n\n`;

        message += `🎯 <b>信号原因:</b> ${signal.signalReason}\n\n`;
        message += `⏰ <b>检测时间:</b> ${signal.timestamp}\n`;
        message += `📅 <b>K线时间:</b> ${new Date(signal.klineTimestamp).toISOString()}`;

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
        checkConfig();
        
        const analyzer = new BSCActiveTokensAnalyzer(
            CONFIG.OKX_API_KEY,
            CONFIG.OKX_SECRET_KEY,
            CONFIG.OKX_API_PASSPHRASE
        );
        
        console.log('🚀 启动BSC活跃代币EMA分析器...');
        
        // 初始化K线缓存
        console.log('📊 初始化K线数据缓存...');
        await analyzer.initializeKlineCache();
        
        // 标记为已初始化
        analyzer.isInitialized = true;
        console.log('✅ 系统初始化完成');
        
        // 启动定时任务
        analyzer.startScheduledTask();
        
        // 保持程序运行
        console.log('🔄 程序正在运行中，按 Ctrl+C 退出...');
        process.on('SIGINT', () => {
            console.log('\n👋 程序正在退出...');
            process.exit(0);
        });
        
        // 防止程序退出
        setInterval(() => {
            // 每小时输出一次状态
            const now = new Date();
            if (now.getMinutes() === 0 && now.getSeconds() === 0) {
                console.log(`💡 系统运行状态正常 - ${now.toISOString()}`);
            }
        }, 1000);
        
    } catch (error) {
        console.error('程序启动失败:', error);
        process.exit(1);
    }
}

// 如果直接运行此文件，执行主函数
if (require.main === module) {
    main();
}

module.exports = BSCActiveTokensAnalyzer;
