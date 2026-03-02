import { Module, OnModuleInit } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { TxAssemblerService } from './tx-assembler.service';
import { PolicyPrecheckService } from './policy-precheck.service';
import { RunStreamService } from './run-stream.service';
import { LlmModule } from './llm/llm.module';
import { DatabaseModule } from '../database/database.module';
import { ProtocolsModule } from '../protocols/protocols.module';
import { HistoryEventsService } from '../history/history-events.service';
import { HistoryProjectionService } from '../history/history-projection.service';
import { AnalysisModule } from '../analysis/analysis.module';
import { MemoryModule } from '../memory/memory.module';
import { ToolRegistry } from './tools/tool.registry';
import { SwapTool } from './tools/swap.tool';
import { SplTransferTool } from './tools/spl-transfer.tool';
import { MultiSendTool } from './tools/multi-send.tool';
import { MarinadeStakeTool } from './tools/marinade-stake.tool';
import { WalletAnalyzeTool } from './tools/wallet-analyze.tool';
import { TokenInfoTool } from './tools/token-info.tool';
import { MarginfiLendTool } from './tools/marginfi-lend.tool';
import { TokenSafetyTool } from './tools/token-safety.tool';
import { CompareYieldsTool } from './tools/compare-yields.tool';
import { GetPnlTool } from './tools/get-pnl.tool';
import { NameResolutionService } from './name-resolution.service';
import { IntentClassifierService } from './intent-classifier.service';
import { MarketContextService } from './market-context.service';

const TOOL_PROVIDERS = [
  SwapTool,
  SplTransferTool,
  MultiSendTool,
  MarinadeStakeTool,
  WalletAnalyzeTool,
  TokenInfoTool,
  MarginfiLendTool,
  TokenSafetyTool,
  CompareYieldsTool,
  GetPnlTool,
];

@Module({
  imports: [LlmModule, DatabaseModule, ProtocolsModule, AnalysisModule, MemoryModule],
  controllers: [AgentController],
  providers: [
    AgentService,
    TxAssemblerService,
    PolicyPrecheckService,
    RunStreamService,
    HistoryEventsService,
    HistoryProjectionService,
    NameResolutionService,
    IntentClassifierService,
    MarketContextService,
    ToolRegistry,
    ...TOOL_PROVIDERS,
  ],
  exports: [
    AgentService,
    TxAssemblerService,
    PolicyPrecheckService,
    RunStreamService,
    HistoryEventsService,
    HistoryProjectionService,
    NameResolutionService,
    IntentClassifierService,
    MarketContextService,
    ToolRegistry,
  ],
})
export class AgentModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly swapTool: SwapTool,
    private readonly splTransferTool: SplTransferTool,
    private readonly multiSendTool: MultiSendTool,
    private readonly marinadeStakeTool: MarinadeStakeTool,
    private readonly walletAnalyzeTool: WalletAnalyzeTool,
    private readonly tokenInfoTool: TokenInfoTool,
    private readonly marginfiLendTool: MarginfiLendTool,
    private readonly tokenSafetyTool: TokenSafetyTool,
    private readonly compareYieldsTool: CompareYieldsTool,
    private readonly getPnlTool: GetPnlTool,
  ) { }

  onModuleInit(): void {
    for (const tool of [
      this.swapTool,
      this.splTransferTool,
      this.multiSendTool,
      this.marinadeStakeTool,
      this.walletAnalyzeTool,
      this.tokenInfoTool,
      this.marginfiLendTool,
      this.tokenSafetyTool,
      this.compareYieldsTool,
      this.getPnlTool,
    ]) {
      this.toolRegistry.register(tool);
    }
  }
}
