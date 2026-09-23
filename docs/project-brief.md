# Agentic SDLC Work Item System

## Overview

A reusable, project-agnostic framework of AI agent definitions and skills that manages the complete lifecycle of **work items** — features, bug fixes, refactoring, technical debt, documentation — in any software project. The framework is designed to be dropped into a repository and configured per project, providing consistent, traceable, human-supervised handling of development work from idea to closure.

## Problem Statement

AI-assisted development today is typically ad hoc: agents are prompted per task, with no shared model of the work, no consistent process, and no traceability. This project establishes a standard capability set so that any software project can delegate work item handling to agents with defined roles, skills, and guardrails.

## Goals

- Define a set of **agents** covering the key SDLC roles
- Define a reusable **skill set** for work item handling
- Support the **full work item lifecycle** in a configurable workflow
- Remain **project-agnostic**: no assumptions about language, stack, or domain
- Keep a **human in the loop** at configurable approval gates