export const modules = [
  {
    "id": "general",
    "path": "/general",
    "name": "通用剪辑",
    "brief": "从视频或文案开始，挑风格做一条片",
    "pro": false,
    "poster": "/home/general-poster.jpg",
    "video": "/home/general-loop.mp4"
  },
  {
    "id": "screen",
    "path": "/screen-motion",
    "name": "录屏运镜",
    "brief": "录下操作，安排镜头，导出清晰演示",
    "pro": false,
    "poster": "/home/module-screen-poster.jpg",
    "video": "/home/module-screen-loop.mp4"
  },
  {
    "id": "koubo",
    "description": "导入口播原片，智能粗剪去掉口误、停顿和重复。动效卡、字幕、配乐一起排好，每一步都能精细调整。",
    "path": "/pro/koubo",
    "name": "口播剪辑",
    "brief": "把口播素材剪成节奏清楚的成片",
    "pro": true,
    "poster": "/home/koubo-poster.jpg",
    "video": "/home/koubo-loop.mp4"
  },
  {
    "id": "motion",
    "description": "小卡、半卡、全卡三种讲解动效卡，按你说的内容自动挑选、排进时间线，一键换风格。",
    "path": "/pro/motion",
    "name": "动效库",
    "brief": "挑选和编排讲解动效卡",
    "pro": true,
    "poster": "/home/module-motion-poster.jpg",
    "video": "/home/module-motion-loop.mp4"
  },
  {
    "id": "reader",
    "description": "贴一个抖音、小红书、公众号或网页链接，取回正文、视频和逐字稿，读完直接存起来写稿用。",
    "path": "/pro/reader",
    "name": "链接读取",
    "brief": "从链接整理正文和视频素材",
    "pro": true,
    "poster": "/home/module-reader-poster.jpg",
    "video": "/home/module-reader-loop.mp4"
  },
  {
    "id": "publish",
    "description": "写稿、自查、审核、标题简介和封面一条龙，最后一键填进抖音、小红书、B 站的发布页。",
    "path": "/pro/publish",
    "name": "文案发布",
    "brief": "写稿、审核并准备平台发布素材",
    "pro": true,
    "poster": "/home/publish-poster.jpg",
    "video": "/home/publish-loop.mp4"
  },
  {
    "id": "analytics",
    "description": "多个平台的数据对齐到一起，逐篇诊断；发布后 6 小时盯着，提前提示可能的爆款和限流。",
    "path": "/pro/analytics",
    "name": "运营分析",
    "brief": "对照内容数据复盘表现",
    "pro": true,
    "poster": "/home/module-analytics-poster.jpg",
    "video": "/home/module-analytics-loop.mp4"
  },
  {
    "id": "topics",
    "description": "设好研究方向，AI 每天帮你找题、核实原文、打分排序。",
    "path": "/pro/topics",
    "name": "智能选题",
    "brief": "整理研究资料，寻找内容方向",
    "pro": true,
    "poster": "/home/module-topics-poster.jpg",
    "video": "/home/module-topics-loop.mp4"
  }
] as const;
