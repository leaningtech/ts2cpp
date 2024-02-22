#ifndef CHEERP_JSHELPER_H
#define CHEERP_JSHELPER_H
#include <type_traits>
namespace [[cheerp::genericjs]] client {
	class _Any;
	template<class... Variants>
	class _Union;
	template<class F>
	class _Function;
	class Object;
	class String;
	template<class T>
	class TArray;
}
namespace [[cheerp::genericjs]] cheerp {
	template<class T>
	struct ArrayElementTypeImpl {
		using type = client::_Any*;
	};
	template<class T>
	struct ArrayElementTypeImpl<client::TArray<T>> {
		using type = T;
	};
	template<class T>
	using ArrayElementType = typename ArrayElementTypeImpl<T>::type;
	template<class T>
	using Normalize = std::remove_cv_t<std::remove_pointer_t<std::remove_reference_t<T>>>;
	template<class T>
	constexpr bool IsCharPointer = std::is_pointer_v<std::decay_t<T>> && std::is_same_v<std::remove_cv_t<std::remove_pointer_t<std::decay_t<T>>>, char>;
	template<class T>
	constexpr bool IsConstReference = std::is_reference_v<T> && std::is_const_v<std::remove_reference_t<T>>;
	template<class From, class To>
	struct CanCastHelper {
		constexpr static bool value = false;
	};
	template<class From, class To, bool IsArithmetic = std::is_arithmetic_v<From> && std::is_arithmetic_v<To>>
	struct CanCastImpl {
		constexpr static bool value = std::is_void_v<To> || std::is_void_v<From> || std::is_same_v<From, client::_Any> || std::is_same_v<To, client::_Any> || std::is_base_of_v<To, From> || CanCastHelper<From, To>::value;
	};
	template<class From, class To>
	struct CanCastImpl<From, To, true> {
		constexpr static bool value = std::is_convertible_v<From, To>;
	};
	template<class From, class... To>
	constexpr bool CanCast = (CanCastImpl<Normalize<From>, Normalize<To>>::value || ...);
	template<class From, class... To>
	constexpr bool CanCastArgs = CanCast<From, To...> || (IsCharPointer<From> && (CanCast<client::String*, To> || ...));
	template<class From, template<class...> class To, class... T>
	struct CanCastHelper<From, To<T...>> {
		template<class... U>
		[[cheerp::genericjs]]
		constexpr static bool test(To<U...>* x) {
			return CanCast<To<U...>*, To<T...>*>;
		}
		[[cheerp::genericjs]]
		constexpr static bool test(void*) {
			return false;
		}
		constexpr static bool value = test((From*) nullptr);
	};
	template<template<class...> class Class, class... From, class... To>
	struct CanCastHelper<Class<From...>, Class<To...>> {
		constexpr static bool value = (CanCast<From, To> && ...);
	};
	template<class From, class To, class... Args>
	struct CanCastHelper<client::_Function<From()>, client::_Function<To(Args...)>> {
		constexpr static bool value = CanCast<From, To>;
	};
	template<class From, class To, class FromFirstArg, class ToFirstArg, class... FromArgs, class... ToArgs>
	struct CanCastHelper<client::_Function<From(FromFirstArg, FromArgs...)>, client::_Function<To(ToFirstArg, ToArgs...)>> {
		constexpr static bool value = CanCast<ToFirstArg, FromFirstArg> && CanCastHelper<client::_Function<From(FromArgs...)>, client::_Function<To(ToArgs...)>>::value;
	};
	template<class... From, class... To>
	struct CanCastHelper<client::_Union<From...>, client::_Union<To...>> {
		constexpr static bool value = (CanCast<From, client::_Union<To...>> && ...);
	};
	template<class... From, class To>
	struct CanCastHelper<client::_Union<From...>, To> {
		constexpr static bool value = (CanCast<From, To> && ...);
	};
	template<class From, class... To>
	struct CanCastHelper<From, client::_Union<To...>> {
		constexpr static bool value = (CanCast<From, To> || ...);
	};
}
namespace [[cheerp::genericjs]] client {
	class [[cheerp::client_layout]] _Any {
		struct [[cheerp::client_layout]] Cast {
			template<class T>
			[[gnu::always_inline]]
			operator T() const {
				T out;
				asm("%1" : "=r"(out) : "r"(this));
				return out;
			}
		};
	public:
		template<class T>
		[[cheerp::client_transparent]]
		_Any(T value);
		template<class T>
		[[gnu::always_inline]]
		T cast() const {
			T out;
			asm("%1" : "=r"(out) : "r"(this));
			return out;
		}
		[[gnu::always_inline]]
		const Cast& cast() const {
			return *reinterpret_cast<const Cast*>(this);
		}
		template<class T>
		[[gnu::always_inline]]
		explicit operator T() const {
			return this->cast<T>();
		}
		[[gnu::always_inline]]
		explicit operator int() const {
			return this->cast<int>();
		}
	};
	template<class... Variants>
	class [[cheerp::client_layout]] _Union {
		struct [[cheerp::client_layout]] Cast {
			template<class T, class = std::enable_if_t<(cheerp::CanCast<Variants, T> || ...)>>
			[[gnu::always_inline]]
			operator T() const {
				T out;
				asm("%1" : "=r"(out) : "r"(this));
				return out;
			}
		};
	public:
		template<class T, class = std::enable_if_t<cheerp::CanCast<T, _Union<Variants...>>>>
		[[cheerp::client_transparent]]
		_Union(T value);
		template<class T, class = std::enable_if_t<(cheerp::CanCast<Variants, T> || ...)>>
		[[gnu::always_inline]]
		T cast() const {
			T out;
			asm("%1" : "=r"(out) : "r"(this));
			return out;
		}
		[[gnu::always_inline]]
		const Cast& cast() const {
			return *reinterpret_cast<const Cast*>(this);
		}
		template<class T, class = std::enable_if_t<(cheerp::CanCast<Variants, T> || ...)>>
		[[gnu::always_inline]]
		explicit operator T() const {
			return this->cast<T>();
		}
	};
}
namespace [[cheerp::genericjs]] cheerp {
	[[gnu::always_inline]]
	inline client::String* makeString(const char* str);
	template<class T>
	[[gnu::always_inline]]
	std::conditional_t<IsCharPointer<T>, client::String*, std::conditional_t<IsConstReference<T>, std::remove_reference_t<T>*, T&&>> clientCast(T&& value) {
		if constexpr (IsCharPointer<T>)
			return makeString(value);
		else if constexpr (IsConstReference<T>)
			return &value;
		else
			return value;
	}
}
#endif
