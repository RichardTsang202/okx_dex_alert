const axios = require('axios');
const fs = require('fs');

class BSCActiveTokensAnalyzer {
    constructor() {
        this.bscChainIndex = '56'; // BSC链索引
        this.baseUrl = 'https://www.okx.com/api/v5/dex';
    }

    // 获取BSC链上交易量最高的代币
    async getTopVolumeBSCTokens() {
        try {
            const url = `${this.baseUrl}/aggregator/top-tokens`;
            const params = {
                chainId: this.bscChainIndex,
                limit: 100
            };
            
            console.log('正在获取BSC链上交易量最高的代币...');
            const response = await axios.get(url, { params });
            
            if (response.data && response.data.code === '0' && response.data.data) {
                const tokens = response.data.data;
                console.log(`成功获取到 ${tokens.length} 个代币`);
                
                // 返回代币地址数组
                return tokens.map(token => ({
                    address: token.tokenContractAddress,
                    symbol: token.tokenSymbol,
                    name: token.tokenName
                }));
            } else {
                console.error('获取代币数据失败:', response.data);
                return [];
            }
        } catch (error) {
            console.error('获取BSC代币时出错:', error.message);
            return [];
        }
    }

    // 获取代币详细信息
    async getTokenInfo(tokenAddress) {
        try {
            const url = `${this.baseUrl}/aggregator/token`;
            const params = {
                chainId: this.bscChainIndex,
                tokenContractAddress: tokenAddress
            };
            
            const response = await axios.get(url, { params });
            
            if (response.data && response.data.code === '0' && response.data.data && response.data.data.length > 0) {
                return response.data.data[0];
            }
            return null;
        } catch (error) {
            console.error(`获取代币信息失败 ${tokenAddress}:`, error.message);
            return null;
        }
    }

    // Telegram配置
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
            });
            
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

    // 获取K线数据
    async getKlineData(tokenAddress, granularity = '5m', limit = 147) {
        try {
            const url = `${this.baseUrl}/aggregator/candlesticks`;
            const params = {
                chainId: this.bscChainIndex,
                tokenContractAddress: tokenAddress,
                period: granularity,
                limit: limit
            };
            
            const response = await axios.get(url, { params });
            
            if (response.data && response.data.code === '0' && response.data.data) {
                return response.data.data;
            }
            return null;
        } catch (error) {
            console.error(`获取K线数据失败 ${tokenAddress}:`, error.message);
            return null;
        }
    }

    // 计算EMA
    calculateEMA(prices, period) {
        if (prices.length < period) return null;
        
        const multiplier = 2 / (period + 1);
        let ema = prices[0];
        
        for (let i = 1; i < prices.length; i++) {
            ema = (prices[i] * multiplier) + (ema * (1 - multiplier));
        }
        
        return ema;
    }

    // 检测EMA多头排列信号
    async checkEMASignal(tokenInfo) {
        try {
            const klineData = await this.getKlineData(tokenInfo.address);
            if (!klineData || klineData.length < 147) {
                return null;
            }
            
            // 提取收盘价
            const closePrices = klineData.map(candle => parseFloat(candle[4]));
            
            // 计算EMA
            const ema21 = this.calculateEMA(closePrices, 21);
            const ema55 = this.calculateEMA(closePrices, 55);
            const ema144 = this.calculateEMA(closePrices, 144);
            
            if (!ema21 || !ema55 || !ema144) {
                return null;
            }
            
            // 检查多头排列：EMA21 > EMA55 > EMA144
            const isBullishAlignment = ema21 > ema55 && ema55 > ema144;
            
            // 检查前一根K线的EMA值，确保是新的信号
            const prevClosePrices = closePrices.slice(0, -1);
            const prevEma21 = this.calculateEMA(prevClosePrices, 21);
            const prevEma55 = this.calculateEMA(prevClosePrices, 55);
            const prevEma144 = this.calculateEMA(prevClosePrices, 144);
            
            const wasPrevBullish = prevEma21 > prevEma55 && prevEma55 > prevEma144;
            
            // 打印EMA值和判断结果
            console.log(`${tokenInfo.symbol}: EMA21=${ema21.toFixed(8)}, EMA55=${ema55.toFixed(8)}, EMA144=${ema144.toFixed(8)}`);
            console.log(`  当前多头排列: ${isBullishAlignment}, 前一根多头排列: ${wasPrevBullish}`);
            
            if (isBullishAlignment && !wasPrevBullish) {
                return {
                    address: tokenInfo.address,
                    symbol: tokenInfo.symbol,
                    name: tokenInfo.name,
                    latestPrice: closePrices[closePrices.length - 1],
                    ema21: ema21,
                    ema55: ema55,
                    ema144: ema144,
                    timestamp: new Date().toISOString()
                };
            }
            
            return null;
        } catch (error) {
            console.error(`检测EMA信号失败 ${tokenInfo.symbol}:`, error.message);
            return null;
        }
    }

    // 格式化Telegram消息
    formatTelegramMessage(signal) {
        return `🚀 <b>EMA多头排列信号</b>\n\n` +
               `代币: <b>${signal.symbol}</b> (${signal.name})\n` +
               `地址: <code>${signal.address}</code>\n` +
               `当前价格: <b>$${this.formatNumber(signal.latestPrice)}</b>\n\n` +
               `📊 <b>EMA指标</b>\n` +
               `EMA21: ${this.formatNumber(signal.ema21)}\n` +
               `EMA55: ${this.formatNumber(signal.ema55)}\n` +
               `EMA144: ${this.formatNumber(signal.ema144)}\n\n` +
               `⏰ 时间: ${new Date(signal.timestamp).toLocaleString('zh-CN')}`;
    }

    // 格式化数字显示
    formatNumber(num) {
        if (num >= 1) {
            return num.toFixed(6);
        } else {
            return num.toFixed(8);
        }
    }

    // 运行分析
    async runAnalysis() {
        try {
            console.log('=== 开始EMA多头排列信号检测 ===');
            
            // 获取候选代币
            const candidateTokens = await this.getTopVolumeBSCTokens();
            if (candidateTokens.length === 0) {
                console.log('未获取到候选代币');
                return;
            }
            
            console.log(`开始检测 ${candidateTokens.length} 个代币的EMA信号...`);
            
            const signalTokens = [];
            
            for (let i = 0; i < candidateTokens.length; i++) {
                const token = candidateTokens[i];
                console.log(`检测代币 ${i + 1}/${candidateTokens.length}: ${token.symbol}`);
                
                const signal = await this.checkEMASignal(token);
                if (signal) {
                    console.log(`🚀 发现EMA多头排列信号: ${signal.symbol}`);
                    signalTokens.push(signal);
                    
                    // 发送Telegram通知
                    const message = this.formatTelegramMessage(signal);
                    await this.sendTelegramMessage(message);
                }
                
                // 添加延迟避免请求过于频繁
                if (i < candidateTokens.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
            
            console.log(`\n=== 分析完成 ===`);
            console.log(`总共分析代币: ${candidateTokens.length}`);
            console.log(`发现EMA多头排列信号: ${signalTokens.length}`);
            
            if (signalTokens.length > 0) {
                console.log('发现的信号:');
                signalTokens.forEach((signal, index) => {
                    console.log(`${index + 1}. ${signal.symbol} (${signal.address})`);
                    console.log(`   价格: $${signal.price}`);
                    console.log(`   EMA5: ${signal.ema5}, EMA10: ${signal.ema10}, EMA20: ${signal.ema20}`);
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
            console.error('运行分析时出错:', error);
            throw error;
        }
    }
}

// 主函数
async function main() {
    try {
        console.log('=== 启动EMA多头排列监控服务 ===');
        
        const analyzer = new BSCActiveTokensAnalyzer();
        
        // 立即执行一次分析
        await analyzer.runAnalysis();
        
        // 设置定时器，每5分钟执行一次
        setInterval(async () => {
            console.log('\n=== 开始新一轮检测 ===');
            try {
                await analyzer.runAnalysis();
            } catch (error) {
                console.error('定时检测出错:', error);
            }
        }, 5 * 60 * 1000); // 5分钟
        
        console.log('监控服务已启动，每5分钟检测一次...');
        console.log('按 Ctrl+C 停止服务');
        
    } catch (error) {
        console.error('启动监控服务失败:', error);
        process.exit(1);
    }
}

// 优雅退出处理
process.on('SIGINT', () => {
    console.log('\n收到退出信号，正在停止监控服务...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n收到终止信号，正在停止监控服务...');
    process.exit(0);
});

// 启动应用
if (require.main === module) {
    main();
}

module.exports = BSCActiveTokensAnalyzer;